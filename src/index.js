const fs = require('fs');
const path = require('path');
const express = require('express');
const https = require('https');
const http = require('http');
const socketIo = require('socket.io');
const ip = require('ip');
const QRCode = require('qrcode');

const PORT = 3001;
const HTTP_PORT = 3002;
const app = express();

// Path to project root
const rootDir = path.join(__dirname, '..');

const server = https.createServer({
  key: fs.readFileSync(path.join(rootDir, 'certs', 'key.pem')),
  cert: fs.readFileSync(path.join(rootDir, 'certs', 'cert.pem'))
}, app);

const httpServer = http.createServer(app);

const io = socketIo(server, {
    cors: { origin: "*" },
    transports: ['polling', 'websocket'] 
});
io.attach(httpServer);

app.use(express.static(path.join(rootDir, 'public')));
app.use('/node_modules', express.static(path.join(rootDir, 'node_modules')));

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

// --- File Upload (Tethered Recording) ---
// Ensure recordings directory exists
const recDir = path.join(rootDir, 'recordings');
if (!fs.existsSync(recDir)) fs.mkdirSync(recDir);

app.post('/upload', (req, res) => {
    const filename = req.query.filename || `rec_${Date.now()}.webm`;
    const filePath = path.join(recDir, filename);
    const writeStream = fs.createWriteStream(filePath);

    console.log(`[Upload] Receiving: ${filename}`);

    req.pipe(writeStream);

    req.on('end', () => {
        console.log(`[Upload] Completed: ${filename}`);
        res.status(200).send('Upload Complete');
    });

    req.on('error', (err) => {
        console.error(`[Upload] Error: ${err}`);
        res.status(500).send('Upload Failed');
    });
});

io.on('connection', (socket) => {
    console.log('[Server] Connected:', socket.id);

    // Camera Registration
    socket.on('join-camera', (meta) => {
        socket.join('camera');
        socket.cameraMeta = meta || {}; // Store name/device info
        console.log(`[Camera Joined] ${socket.id} - ${JSON.stringify(meta)}`);
        io.to('remote').emit('camera-joined', { id: socket.id, meta: socket.cameraMeta });
    });

    socket.on('join-remote', () => {
        socket.join('remote');
        // Send list of existing cameras to the new remote
        const cameras = [];
        const room = io.sockets.adapter.rooms.get('camera');
        if (room) {
            room.forEach(id => {
                const s = io.sockets.sockets.get(id);
                if (s) cameras.push({ id: s.id, meta: s.cameraMeta });
            });
        }
        socket.emit('camera-list', cameras);
    });

    // Multi-Cam Signaling Routing
    // Camera -> Remote: Wrap with ID
    socket.on('offer', (payload) => {
        io.to('remote').emit('offer', { from: socket.id, payload });
    });
    
    socket.on('camera-candidate', (payload) => {
        io.to('remote').emit('camera-candidate', { from: socket.id, payload });
    });

    // Remote -> Specific Camera
    socket.on('answer', (data) => {
        // data: { target: 'socket_id', payload: sdp }
        io.to(data.target).emit('answer', data.payload);
    });

    socket.on('remote-candidate', (data) => {
        io.to(data.target).emit('remote-candidate', data.payload);
    });

    // Targeted Commands (Remote -> Camera)
    const cmds = ['start-recording', 'stop-recording', 'take-photo', 'switch-camera', 'switch-lens', 'control-camera', 'request-state', 'set-gain'];
    cmds.forEach(cmd => {
        socket.on(cmd, (data) => {
            // Check if data has a 'target' field, otherwise broadcast (legacy support)
            if (data && data.target) {
                io.to(data.target).emit(cmd, data.payload);
            } else {
                io.to('camera').emit(cmd, data); // Legacy broadcast
            }
        });
    });

    // Feedback (Camera -> Remote)
    // Wrap with ID so remote knows which camera sent it
    socket.on('camera-state', (s) => io.to('remote').emit('camera-state', { from: socket.id, payload: s }));
    socket.on('camera-devices', (d) => io.to('remote').emit('camera-devices', { from: socket.id, payload: d }));
    socket.on('camera-capabilities', (c) => io.to('remote').emit('camera-capabilities', { from: socket.id, payload: c }));
    socket.on('thermal-warning', (w) => io.to('remote').emit('thermal-warning', { from: socket.id, payload: w }));
    
    socket.on('log', (data) => {
        console.log(`[${data.source}] [${data.level}] ${data.message}`);
    });

    socket.on('disconnect', () => {
        console.log('[Server] Disconnected:', socket.id);
        if (socket.cameraMeta) {
            io.to('remote').emit('camera-left', { id: socket.id });
        }
    });
});

// Start Server
const HOST_IP = process.env.HOST_IP || ip.address();

server.listen(PORT, '0.0.0.0', () => {
    console.log(`HTTPS Server running at https://${HOST_IP}:${PORT}`);
});

httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
    console.log(`HTTP Server running at http://${HOST_IP}:${HTTP_PORT}`);
    console.log(`OBS Feed (HTTP): http://${HOST_IP}:${HTTP_PORT}/obs.html`);
    console.log(`OBS Dock (HTTP): http://${HOST_IP}:${HTTP_PORT}/control.html`);
});