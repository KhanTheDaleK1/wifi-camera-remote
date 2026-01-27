const socket = io({ transports: ['polling', 'websocket'] });
window.Logger.init(socket, 'Camera');

const els = {
    start: document.getElementById('start-screen'),
    overlay: document.getElementById('camera-overlay'),
    video: document.getElementById('viewfinder'),
    status: document.getElementById('status-text'),
    recDot: document.getElementById('rec-dot'),
    dlBtn: document.getElementById('dl-btn')
};

const noSleep = new NoSleep();
let stream = null;
let track = null;
let peer = null;
let recorder = null;
let chunks = [];
let state = 'IDLE'; // IDLE, PREVIEW, RECORDING

// --- 1. Initialization (User Interaction) ---
els.start.addEventListener('click', async () => {
    try {
        noSleep.enable(); // Wake Lock
        els.start.classList.add('hidden');
        els.overlay.classList.remove('hidden');
        
        await startCamera();
        
        socket.emit('join-camera');
        updateStatus('Ready');
    } catch (e) {
        showError(e);
    }
});

// --- 2. Camera Management ---
async function startCamera(deviceId = null) {
    if (stream) {
        stream.getTracks().forEach(t => t.stop());
    }

    const constraints = {
        audio: true,
        video: {
            // Default to environment, simple settings first
            facingMode: deviceId ? undefined : 'environment',
            deviceId: deviceId ? { exact: deviceId } : undefined,
            // Don't force resolution yet to avoid "OverconstrainedError" on old devices
        }
    };

    try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        els.video.srcObject = stream;
        await els.video.play(); // Explicit play
        
        track = stream.getVideoTracks()[0];
        
        // Broadcast capabilities
        broadcastCaps();
        broadcastDevices();
        
        // Start WebRTC
        initPeer();

    } catch (e) {
        throw new Error(`Cam Init Failed: ${e.message}`);
    }
}

function broadcastCaps() {
    if (!track) return;
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    // iOS Fallbacks
    if (!caps.zoom) caps.zoom = { min: 1, max: 10, step: 0.1 };
    if (!caps.torch) caps.torch = true;
    
    socket.emit('camera-capabilities', caps);
}

async function broadcastDevices() {
    const devs = await navigator.mediaDevices.enumerateDevices();
    socket.emit('camera-devices', devs.filter(d => d.kind === 'videoinput'));
}

// --- 3. WebRTC Streaming ---
const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

function initPeer() {
    if (peer) peer.close();
    peer = new RTCPeerConnection(rtcConfig);
    
    stream.getTracks().forEach(t => peer.addTrack(t, stream));
    
    peer.onicecandidate = e => {
        if (e.candidate) socket.emit('camera-candidate', e.candidate);
    };
    
    peer.createOffer().then(o => peer.setLocalDescription(o)).then(() => {
        socket.emit('offer', peer.localDescription);
    });
}

socket.on('answer', ans => peer && peer.setRemoteDescription(ans));
socket.on('remote-candidate', c => peer && peer.addIceCandidate(c));
socket.on('request-state', () => {
    broadcastCaps(); 
    broadcastDevices();
    // Re-offer if needed
    if (peer && peer.signalingState === 'stable') initPeer();
});


// --- 4. Recording ---
function startRecord() {
    if (!stream) return;
    chunks = [];
    
    try {
        // Try better codecs if available
        const options = MediaRecorder.isTypeSupported('video/mp4') ? { mimeType: 'video/mp4' } : {};
        recorder = new MediaRecorder(stream, options);
    } catch (e) {
        recorder = new MediaRecorder(stream);
    }

    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = saveRecord;
    
    recorder.start();
    state = 'RECORDING';
    updateStatus('REC');
    els.recDot.classList.add('active');
    els.dlBtn.classList.add('hidden');
    socket.emit('camera-state', 'recording');
}

function stopRecord() {
    if (recorder && state === 'RECORDING') {
        recorder.stop();
        state = 'PREVIEW';
        updateStatus('Saving...');
        els.recDot.classList.remove('active');
        socket.emit('camera-state', 'idle');
    }
}

function saveRecord() {
    const blob = new Blob(chunks, { type: recorder.mimeType });
    const url = URL.createObjectURL(blob);
    const fname = `rec_${Date.now()}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`;
    
    els.dlBtn.onclick = () => {
        const a = document.createElement('a');
        a.href = url;
        a.download = fname;
        a.click();
    };
    els.dlBtn.classList.remove('hidden');
    updateStatus('File Ready');
}

function takePhoto() {
    const canvas = document.createElement('canvas');
    canvas.width = els.video.videoWidth;
    canvas.height = els.video.videoHeight;
    canvas.getContext('2d').drawImage(els.video, 0, 0);
    
    canvas.toBlob(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `photo_${Date.now()}.png`;
        a.click();
        updateStatus('Photo Saved');
        setTimeout(() => updateStatus('Ready'), 1500);
    }, 'image/png');
}


// --- 5. Controls & Events ---
socket.on('start-recording', startRecord);
socket.on('stop-recording', stopRecord);
socket.on('take-photo', takePhoto);

socket.on('switch-camera', () => {
    // Basic toggle
    const current = track.getSettings().facingMode;
    const next = current === 'user' ? 'environment' : 'user';
    // We restart completely to apply new constraints safely
    // Note: This logic assumes simple switching. 
    // Ideally we iterate devices, but this is a quick toggle.
    if (stream) stream.getTracks().forEach(t => t.stop());
    
    navigator.mediaDevices.getUserMedia({ video: { facingMode: next }, audio: true })
        .then(s => {
            stream = s;
            els.video.srcObject = s;
            els.video.play();
            track = s.getVideoTracks()[0];
            initPeer(); // Re-negotiate WebRTC
            broadcastCaps();
        });
});

socket.on('switch-lens', (id) => startCamera(id)); // Re-init with specific ID

socket.on('control-camera', async (c) => {
    if (!track) return;
    try {
        const advanced = {};
        // Map simplified keys to advanced constraints
        if (c.zoom) advanced.zoom = c.zoom;
        if (c.torch !== undefined) advanced.torch = c.torch;
        if (c.exposureCompensation) advanced.exposureCompensation = c.exposureCompensation;
        if (c.focusDistance) {
            advanced.focusMode = 'manual';
            advanced.focusDistance = c.focusDistance;
        }
        
        // Resolution (Simple map)
        // Note: applyConstraints for res often fails on mobile. 
        // Better to re-getUserMedia, but let's try.
        if (c.resolution) {
           const map = { '4K': 2160, '1080p': 1080, '720p': 720 };
           if (map[c.resolution]) {
               // We actually need to re-request stream for resolution changes usually
               // But let's try constraint application first
               await track.applyConstraints({ height: { ideal: map[c.resolution] } });
           }
        }
        
        if (c.frameRate) {
           advanced.frameRate = { ideal: parseInt(c.frameRate) };
           // For high framerates (Slo-mo), we might need to apply it to the main constraint block
           await track.applyConstraints({ frameRate: { ideal: parseInt(c.frameRate) } });
        }
        
        await track.applyConstraints({ advanced: [advanced] });
        console.log('Applied Constraints:', advanced);
    } catch (e) {
});


// --- Helpers ---
function updateStatus(msg) {
    els.status.innerText = msg;
    if (msg.includes('Error')) els.status.style.color = 'red';
    else els.status.style.color = 'white';
}

function showError(err) {
    alert(err.message); // Native alert is safest for critical failures
    console.error(err);
}
