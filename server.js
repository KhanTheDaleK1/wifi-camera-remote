const express = require('express');
const https = require('https');
const fs = require('fs');
const socketIo = require('socket.io');
const ip = require('ip');
const path = require('path');
const QRCode = require('qrcode');

const PORT = 3000;
const app = express();
const server = https.createServer({
  key: fs.readFileSync('key.pem'),
  cert: fs.readFileSync('cert.pem')
}, app);

const io = socketIo(server, {
    cors: { origin: "*" },
    transports: ['polling', 'websocket'] 
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/node_modules', express.static(path.join(__dirname, 'node_modules')));

app.get('/network-info', async (req, res) => {
    const url = `https://${ip.address()}:${PORT}/camera.html`;
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
    const cmds = ['start-recording', 'stop-recording', 'take-photo', 'switch-camera', 'switch-lens', 'control-camera', 'request-state'];
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

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at https://${ip.address()}:${PORT}`);
});