const express = require('express');
const https = require('https');
const fs = require('fs');
const socketIo = require('socket.io');
const ip = require('ip');
const path = require('path');
const QRCode = require('qrcode');

// --- Configuration ---
const PORT = 3000;
const LOG_FILE = path.join(__dirname, 'server.log');

// --- Setup ---
const app = express();
const server = https.createServer({
  key: fs.readFileSync('key.pem'),
  cert: fs.readFileSync('cert.pem')
}, app);

// Force polling for better iOS/Self-Signed Cert compatibility
const io = socketIo(server, {
    cors: { origin: "*" },
    transports: ['polling', 'websocket'] 
});

// --- Logging System ---
function log(source, level, message) {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [${source}] [${level}] ${message}`;
    console.log(line);
    fs.appendFile(LOG_FILE, line + '\n', () => {});
}

// --- Express Middleware ---
app.use(express.static(path.join(__dirname, 'public')));
app.use('/node_modules', express.static(path.join(__dirname, 'node_modules')));

// --- Routes ---
app.get('/network-info', async (req, res) => {
    const url = `https://${ip.address()}:${PORT}/camera.html`;
    try {
        const qr = await QRCode.toDataURL(url);
        res.json({ url, qr });
    } catch (e) {
        res.status(500).send(e.toString());
    }
});

app.get('/logs', (req, res) => {
    if (fs.existsSync(LOG_FILE)) res.sendFile(LOG_FILE);
    else res.send('No logs yet');
});

// --- Socket.io Logic ---
io.on('connection', (socket) => {
    log('Server', 'INFO', `Client Connected: ${socket.id}`);

    // Client-side log forwarding
    socket.on('log', (data) => {
        log(data.source, data.level, data.message);
    });

    // Roles
    socket.on('join-camera', () => {
        socket.join('camera');
        log('Server', 'INFO', 'Camera joined channel');
    });

    socket.on('join-remote', () => {
        socket.join('remote');
        log('Server', 'INFO', 'Remote joined channel');
        io.to('camera').emit('request-state'); // Sync state
    });

    // Signaling (WebRTC)
    socket.on('offer', (d) => io.to('remote').emit('offer', d));
    socket.on('answer', (d) => io.to('camera').emit('answer', d));
    socket.on('ice-candidate', (d) => {
        // Broadcast to "other" room implicitly by event name
        // Camera sends 'ice-candidate', we assume it goes to Remote?
        // Let's be explicit like before
    });
    
    socket.on('camera-candidate', (d) => io.to('remote').emit('camera-candidate', d));
    socket.on('remote-candidate', (d) => io.to('camera').emit('remote-candidate', d));

    // Commands (Remote -> Camera)
    const commands = [
        'start-recording', 'stop-recording', 'take-photo', 
        'switch-camera', 'switch-lens', 'control-camera', 
        'get-devices'
    ];
    
    commands.forEach(cmd => {
        socket.on(cmd, (payload) => {
            io.to('camera').emit(cmd, payload);
        });
    });

    // Updates (Camera -> Remote)
    socket.on('camera-state', (state) => io.to('remote').emit('camera-state', state));
    socket.on('camera-devices', (devices) => io.to('remote').emit('camera-devices', devices));
    socket.on('camera-capabilities', (caps) => io.to('remote').emit('camera-capabilities', caps));
    socket.on('camera-error', (msg) => io.to('remote').emit('camera-error', msg));

    socket.on('disconnect', () => {
        log('Server', 'INFO', `Client Disconnected: ${socket.id}`);
    });
});

// --- Start ---
server.listen(PORT, '0.0.0.0', () => {
    log('System', 'INFO', `Server running at https://${ip.address()}:${PORT}`);
});
