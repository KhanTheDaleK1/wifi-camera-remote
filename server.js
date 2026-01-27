const fs = require('fs');
fs.writeFileSync('debug_start.log', 'Starting server...\n');
const express = require('express');
const https = require('https');
const socketIo = require('socket.io');
const ip = require('ip');
const path = require('path');
const QRCode = require('qrcode');

const http = require('http');

const PORT = 3001;
const HTTP_PORT = 3002;
const app = express();

const server = https.createServer({
  key: fs.readFileSync('key.pem'),
  cert: fs.readFileSync('cert.pem')
}, app);

const httpServer = http.createServer(app);

const io = socketIo(server, {
    cors: { origin: "*" },
    transports: ['polling', 'websocket'] 
});
io.attach(httpServer);

app.use(express.static(path.join(__dirname, 'public')));
app.use('/node_modules', express.static(path.join(__dirname, 'node_modules')));

app.use(function(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
});

app.get('/network-info', async (req, res) => {
    const HOST_IP = process.env.HOST_IP || ip.address();
    const url = `https://${HOST_IP}:${PORT}/camera.html`;
    try {
        const qr = await QRCode.toDataURL(url);
        res.json({ url, qr });
    } catch (e) {
        res.status(500).send(e.toString());
    }
});

io.on('connection', (socket) => {
    console.log('[Server] Connected:', socket.id);

    socket.on('join-camera', () => socket.join('camera'));
    socket.on('join-remote', () => socket.join('remote'));

    // Signaling
    socket.on('offer', (d) => io.to('remote').emit('offer', d));
    socket.on('answer', (d) => io.to('camera').emit('answer', d));
    socket.on('camera-candidate', (d) => io.to('remote').emit('camera-candidate', d));
    socket.on('remote-candidate', (d) => io.to('camera').emit('remote-candidate', d));

    // Commands
    const cmds = ['start-recording', 'stop-recording', 'take-photo', 'switch-camera', 'switch-lens', 'control-camera', 'request-state', 'set-gain'];
    cmds.forEach(cmd => {
        socket.on(cmd, (payload) => io.to('camera').emit(cmd, payload));
    });

    // Feedback
    socket.on('camera-state', (s) => io.to('remote').emit('camera-state', s));
    socket.on('camera-devices', (d) => io.to('remote').emit('camera-devices', d));
    socket.on('camera-capabilities', (c) => io.to('remote').emit('camera-capabilities', c));
    
    socket.on('log', (data) => {
        console.log(`[${data.source}] [${data.level}] ${data.message}`);
    });

    socket.on('disconnect', () => console.log('[Server] Disconnected:', socket.id));
});

// ... existing imports ...

try {
    const HOST_IP = process.env.HOST_IP || ip.address();
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`HTTPS Server running at https://${HOST_IP}:${PORT}`);
    });

    httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
        console.log(`HTTP Server running at http://${HOST_IP}:${HTTP_PORT}`);
        console.log(`OBS Feed (HTTP): http://${HOST_IP}:${HTTP_PORT}/obs.html`);
        console.log(`OBS Dock (HTTP): http://${HOST_IP}:${HTTP_PORT}/control.html`);
    });
} catch (e) {
    fs.writeFileSync('startup_error.log', e.toString());
}