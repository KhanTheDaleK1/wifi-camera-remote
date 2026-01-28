const fs = require('fs');
const path = require('path');
const express = require('express');
const https = require('https');
const http = require('http');
const socketIo = require('socket.io');
const ip = require('ip');
const QRCode = require('qrcode');
const androidLauncher = require('./android-launcher');

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

// Upload State Tracking
const uploadStreams = new Map(); // socket.id -> { stream, filename }

io.on('connection', (socket) => {
    console.log('[Server] Connected:', socket.id);

    // --- Tethered Upload Handlers ---
    socket.on('start-upload', ({ filename }, ack) => {
        try {
            const filePath = path.join(recDir, filename);
            const stream = fs.createWriteStream(filePath);
            uploadStreams.set(socket.id, { stream, filename });
            console.log(`[Upload] Started streaming: ${filename}`);
            if (ack) ack({ success: true });
        } catch (e) {
            console.error(`[Upload] Start failed: ${e.message}`);
            if (ack) ack({ success: false, error: e.message });
        }
    });

    socket.on('upload-chunk', (data, ack) => {
        const active = uploadStreams.get(socket.id);
        if (!active) {
            if (ack) ack({ success: false, error: "No active stream" });
            return;
        }
        
        // Write chunk to disk
        active.stream.write(data, (err) => {
            if (err) {
                console.error(`[Upload] Write error: ${err.message}`);
                if (ack) ack({ success: false, error: err.message });
            } else {
                if (ack) ack({ success: true });
            }
        });
    });

    socket.on('end-upload', (data, ack) => {
        const active = uploadStreams.get(socket.id);
        if (active) {
            active.stream.end();
            console.log(`[Upload] Finished: ${active.filename}`);
            uploadStreams.delete(socket.id);
            if (ack) ack({ success: true });
        }
    });

    socket.on('cancel-upload', () => {
        const active = uploadStreams.get(socket.id);
        if (active) {
            active.stream.end();
            console.warn(`[Upload] Cancelled/Aborted: ${active.filename}`);
            // Optional: Delete partial file? For safety, we keep it.
            uploadStreams.delete(socket.id);
        }
    });

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
    
    // Camera -> Remote (Targeted Offer)
    socket.on('offer', (data) => {
        // data can be just payload (legacy broadcast) or { target, payload }
        if (data.target) {
            io.to(data.target).emit('offer', { from: socket.id, payload: data.payload });
        } else {
            io.to('remote').emit('offer', { from: socket.id, payload: data });
        }
    });
    
    socket.on('camera-candidate', (data) => {
        if (data.target) {
            io.to(data.target).emit('camera-candidate', { from: socket.id, payload: data.payload });
        } else {
            // Legacy broadcast (mostly unused now)
            io.to('remote').emit('camera-candidate', { from: socket.id, payload: data });
        }
    });

    // Remote -> Specific Camera
    socket.on('answer', (data) => {
        // data: { target: 'socket_id', payload: sdp }
        // We need to tell the camera WHO sent the answer
        io.to(data.target).emit('answer', { from: socket.id, payload: data.payload });
    });

    socket.on('remote-candidate', (data) => {
        io.to(data.target).emit('remote-candidate', { from: socket.id, payload: data.payload });
    });

    // Targeted Commands (Remote -> Camera)
    const cmds = ['start-recording', 'stop-recording', 'take-photo', 'switch-camera', 'switch-lens', 'control-camera', 'request-state', 'set-gain', 'set-tether', 'set-audio-mode', 'set-track-mode'];
    cmds.forEach(cmd => {
        socket.on(cmd, (data) => {
            const payload = (data && data.payload) ? data.payload : data;
            const msg = { from: socket.id, payload: payload };
            
            if (data && data.target) {
                if (data.target === 'all') {
                    io.to('camera').emit(cmd, msg);
                } else {
                    io.to(data.target).emit(cmd, msg);
                }
            } else {
                io.to('camera').emit(cmd, msg); // Legacy
            }
        });
    });

    // Feedback (Camera -> Remote)
    // Wrap with ID so remote knows which camera sent it
    socket.on('camera-state', (s) => io.to('remote').emit('camera-state', { from: socket.id, payload: s }));
    socket.on('camera-devices', (d) => io.to('remote').emit('camera-devices', { from: socket.id, payload: d }));
    socket.on('camera-capabilities', (c) => io.to('remote').emit('camera-capabilities', { from: socket.id, payload: c }));
    socket.on('thermal-warning', (w) => io.to('remote').emit('thermal-warning', { from: socket.id, payload: w }));
    
    // --- New: Video Switcher Logic ---
    // 1. Thumbnails (Camera -> Docks)
    socket.on('preview-frame', (frame) => {
        // frame: base64 string
        // Broadcast to 'remote' room (which includes the dock)
        io.to('remote').emit('preview-frame', { from: socket.id, payload: frame });
    });

    // 2. Program Switcher (Dock -> OBS View)
    socket.on('program-change', (targetId) => {
        // targetId: 'grid' or specific socketId
        io.emit('program-change', targetId); // Broadcast to everyone (OBS View listens)
    });

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
const os = require('os');

server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n--- HTTPS Server Running ---`);
    console.log(`Port: ${PORT}`);
    
    // Start Android Auto-Launcher
    androidLauncher.start();

    console.log(`Available Networks:`);
    
    const interfaces = os.networkInterfaces();
    Object.keys(interfaces).forEach((ifname) => {
        interfaces[ifname].forEach((iface) => {
            if ('IPv4' !== iface.family || iface.internal !== false) return;
            // Highlight likely USB interfaces (often named rndis, eth, or en with 192.168.x.x)
            const isUSB = ifname.toLowerCase().includes('rndis') || ifname.toLowerCase().includes('usb') || ifname.toLowerCase().includes('eth');
            const label = isUSB ? " (Likely USB/Ethernet)" : "";
            console.log(`  - ${ifname}: https://${iface.address}:${PORT} ${label}`);
        });
    });
    console.log(`----------------------------\n`);
});

httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
    console.log(`HTTP Server running at port ${HTTP_PORT} (OBS/Control)`);
    console.log(`OBS Feed: http://localhost:${HTTP_PORT}/obs.html`);
});