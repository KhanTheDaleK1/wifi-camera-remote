const express = require('express');
const https = require('https');
const fs = require('fs');
const socketIo = require('socket.io');
const ip = require('ip');
const path = require('path');
const QRCode = require('qrcode');

const app = express();
const PORT = 3000;

const server = https.createServer({
  key: fs.readFileSync('key.pem'),
  cert: fs.readFileSync('cert.pem')
}, app);

const io = socketIo(server);

const networkUrl = `https://${ip.address()}:${PORT}/camera.html`;

// Endpoints
app.get('/network-info', async (req, res) => {
    try {
        const qrDataUrl = await QRCode.toDataURL(networkUrl);
        res.json({ url: networkUrl, qr: qrDataUrl });
    } catch (err) {
        res.status(500).send(err);
    }
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/node_modules', express.static(path.join(__dirname, 'node_modules')));

// Socket.io connection handling
io.on('connection', (socket) => {
  
  socket.on('join-camera', () => {
    socket.join('camera');
  });

  socket.on('join-remote', () => {
    socket.join('remote');
    io.to('camera').emit('request-status');
  });

  // Remote triggers
  socket.on('trigger-stop', () => {
    io.to('camera').emit('stop-recording');
  });

  socket.on('trigger-photo', () => {
    io.to('camera').emit('take-photo');
  });

  // Camera Control (Zoom, Torch, etc.)
  socket.on('control-camera', (constraints) => {
    io.to('camera').emit('apply-constraints', constraints);
  });
  
  // Camera Switch
  socket.on('switch-camera', () => {
      io.to('camera').emit('switch-camera');
  });

  // WebRTC Signaling
  socket.on('offer', (payload) => {
    io.to('remote').emit('offer', payload);
  });

  socket.on('answer', (payload) => {
    io.to('camera').emit('answer', payload);
  });

  socket.on('ice-candidate', (incoming) => {
    // Forward candidate to the "other" party
    // We need to know who sent it to send it to the right place
    // A simple way is to broadcast to the room that isn't the sender, 
    // or just rely on specific event names for direction.
    // Let's use specific events for clarity given the strict roles.
  });
  
  socket.on('camera-candidate', (candidate) => {
      io.to('remote').emit('camera-candidate', candidate);
  });
  
  socket.on('remote-candidate', (candidate) => {
      io.to('camera').emit('remote-candidate', candidate);
  });

  // Camera status updates
  socket.on('camera-status', (status) => {
    // status: 'standby', 'recording', 'saving'
    io.to('remote').emit('status-update', status);
  });
  
  socket.on('camera-capabilities', (caps) => {
      io.to('remote').emit('camera-capabilities', caps);
  });
  
  socket.on('camera-devices', (devices) => {
      io.to('remote').emit('camera-devices', devices);
  });

  socket.on('get-devices', () => {
      io.to('camera').emit('get-devices');
  });

  socket.on('switch-lens', (deviceId) => {
      io.to('camera').emit('switch-lens', deviceId);
  });
  
  // Remote Download Streaming
  socket.on('video-chunk', (chunk) => {
      io.to('remote').emit('video-chunk', chunk);
  });
  
  socket.on('download-ready', () => {
      io.to('remote').emit('download-ready');
  });

  // Remote triggers
  socket.on('trigger-record', (options) => {
    io.to('camera').emit('start-recording', options);
  });

  // Camera error updates
  socket.on('camera-error', (errorMsg) => {
      io.to('remote').emit('error-update', errorMsg);
  });

  socket.on('disconnect', () => {
    // Client disconnected
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n--- Server Started ---');
  console.log(`Local Access:   https://localhost:${PORT}`);
  console.log(`Network Access: https://${ip.address()}:${PORT}`);
  console.log(`\nNote: You must accept the self-signed certificate warning in your browser.`);
});
