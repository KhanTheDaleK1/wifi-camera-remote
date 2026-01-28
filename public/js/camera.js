const socket = io({ 
    transports: ['polling'],
    reconnection: true,
    reconnectionDelay: 500
});
const noSleep = new NoSleep();

const els = {
    btn: document.getElementById('start-btn'),
    start: document.getElementById('start-screen'),
    overlay: document.getElementById('camera-overlay'),
    video: document.getElementById('viewfinder'),
    status: document.getElementById('status-text'),
    recDot: document.getElementById('rec-dot'),
    dlBtn: document.getElementById('dl-btn')
};

let stream, recorder, peer, track;
let chunks = [];
let state = 'IDLE';

// --- Robust Upload Manager ---
class UploadManager {
    constructor(socket) {
        this.socket = socket;
        this.queue = [];
        this.isUploading = false;
        this.fallbackMode = false;
        this.filename = null;
        this.totalSize = 0;
    }

    start(filename) {
        this.filename = filename;
        this.queue = [];
        this.isUploading = false;
        this.fallbackMode = false;
        this.totalSize = 0;
        
        if (currentSettings.saveToHost && this.socket.connected) {
            console.log("UploadManager: Starting Tethered Upload...");
            this.socket.emit('start-upload', { filename }, (response) => {
                if (!response || !response.success) {
                    console.warn("UploadManager: Server rejected upload. Falling back to local.");
                    this.fallbackMode = true;
                    els.status.innerText = "REC (Local)";
                } else {
                    els.status.innerText = "REC (USB)";
                }
            });
        } else {
            this.fallbackMode = true; // Default to local if not enabled or disconnected
        }
    }

    addChunk(chunk) {
        this.queue.push(chunk);
        this.totalSize += chunk.size;
        
        // If we are in tethered mode and not broken, try to upload
        if (!this.fallbackMode && currentSettings.saveToHost) {
            this.processQueue();
        }
    }

    processQueue() {
        if (this.isUploading || this.queue.length === 0 || this.fallbackMode) return;

        this.isUploading = true;
        const chunk = this.queue[0]; // Peek

        // Send binary chunk
        this.socket.emit('upload-chunk', chunk, (ack) => {
            if (ack && ack.success) {
                // Success: Remove chunk from queue
                this.queue.shift();
                this.isUploading = false;
                // If more chunks, process next
                if (this.queue.length > 0) this.processQueue();
            } else {
                // Failure: Trigger Fallback
                console.error("UploadManager: Chunk upload failed. Switching to seamless fallback.");
                this.triggerFallback();
            }
        });
        
        // Safety timeout in case server never acks (3s)
        setTimeout(() => {
            if (this.isUploading) {
                 console.warn("UploadManager: Chunk Ack Timeout. Switching to fallback.");
                 this.triggerFallback();
            }
        }, 3000);
    }

    triggerFallback() {
        this.fallbackMode = true;
        this.isUploading = false;
        this.socket.emit('cancel-upload'); // Tell server we gave up
        els.status.innerText = "REC (Fallback)";
        socket.emit('log', { source: 'Camera', level: 'WARN', message: 'USB/Network drop detected. Saving locally.' });
    }

    async stop() {
        if (!this.fallbackMode && currentSettings.saveToHost) {
            // Wait for remaining queue?
            if (this.queue.length > 0) {
                 els.status.innerText = "Finishing...";
                 // Try one last burst to clear queue
                 // For now, simpler to just close. If queue > 0, we might want to warn or fallback.
                 // In a perfect world, we await the queue drain. 
                 // Here, if queue is backed up, we fallback to save the whole thing locally to be safe.
            }
            
            if (this.queue.length === 0) {
                this.socket.emit('end-upload');
                els.status.innerText = "Saved to Host";
                socket.emit('log', { source: 'Camera', level: 'SUCCESS', message: `Offloaded ${this.filename}` });
                return true; // Handled by host
            }
        }
        return false; // Needs local save
    }
    
    getAllChunks() {
        // Return everything for local saving (we kept 'chunks' array in global scope as backup anyway)
        return chunks; 
    }
}

const uploader = new UploadManager(socket);

// Pro Settings State
let currentSettings = {
    deviceId: null,
    resolution: 1080,
    fps: 30,
    recordingBitrate: 250000000, // Default to Extreme (250 Mbps)
    saveToHost: false,
    proAudio: false
};

// --- Wake Lock ---
let wakeLock = null;
async function requestWakeLock() {
    try {
        wakeLock = await navigator.wakeLock.request('screen');
        console.log('Screen Wake Lock active');
        wakeLock.addEventListener('release', () => console.log('Wake Lock released'));
    } catch (err) {
        console.warn(`${err.name}, ${err.message}`);
    }
}

// --- Connection Recovery ---
socket.on('connect', () => {
    console.log('Socket Connected');
    // Register with some metadata (Name/UserAgent)
    const deviceName = navigator.userAgent.match(/\(([^)]+)\)/)[1] || 'Mobile Device';
    socket.emit('join-camera', { name: deviceName });
    
    if (stream) {
        initRTC();
        socket.emit('camera-state', state === 'RECORDING' ? 'recording' : 'idle');
    }
});

els.btn.onclick = async () => {
    try {
        // Try native Wake Lock first, fall back to NoSleep
        if ('wakeLock' in navigator) {
            await requestWakeLock();
            document.addEventListener('visibilitychange', async () => {
                if (wakeLock !== null && document.visibilityState === 'visible') {
                    await requestWakeLock();
                }
            });
        } else {
            noSleep.enable();
        }
        
        await startCamera();
        els.start.classList.add('hidden');
        els.overlay.classList.remove('hidden');
    } catch (e) { alert("Fail: " + e.message); }
};

async function startCamera(updates = {}) {
    Object.assign(currentSettings, updates);
    
    // Auto-tuning on first run if no specific updates are passed
    if (Object.keys(updates).length === 0 && typeof DeviceTuner !== 'undefined') {
        try {
            const tuned = await DeviceTuner.getOptimizedConstraints();
            console.log("Applying Tuned Profile:", tuned);
            if (!currentSettings.resolution) currentSettings.resolution = tuned.height;
            if (!currentSettings.fps) currentSettings.fps = tuned.frameRate;
            // Note: We keep recordingBitrate high (250M) for local recording, 
            // the tuner bitrate is mainly for the WebRTC stream if we were setting sender parameters.
        } catch (e) {
            console.warn("Tuner failed, using defaults", e);
        }
    }

    console.log('Applying Settings:', currentSettings);

    if (stream) stream.getTracks().forEach(t => t.stop());

    const audioConstraints = currentSettings.proAudio ? {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 2
    } : true;

    const constraints = {
        audio: audioConstraints,
        video: { 
            facingMode: currentSettings.deviceId ? undefined : 'environment',
            deviceId: currentSettings.deviceId ? { exact: currentSettings.deviceId } : undefined,
            width: { ideal: (currentSettings.resolution === 2160) ? 3840 : (currentSettings.resolution === 1080 ? 1920 : 1280) },
            height: { ideal: currentSettings.resolution },
            frameRate: { ideal: currentSettings.fps }
        }
    };

    try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        els.video.srcObject = stream;
        track = stream.getVideoTracks()[0];
        
        const devs = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devs.filter(d => d.kind === 'videoinput');
        socket.emit('camera-devices', videoInputs); // This goes to server -> remote room
        
        if (track.getCapabilities) {
            const caps = track.getCapabilities();
            socket.emit('camera-capabilities', caps); // This goes to server -> remote room
        }
        
        initRTC();
    } catch (e) {
        console.error('Camera access failed:', e);
        // Fallback to default if specific settings fail (e.g. 120fps not supported at 4K)
        if (Object.keys(updates).length > 0) {
            console.warn('Retrying with defaults...');
            await startCamera({ resolution: 1080, fps: 30 });
        }
    }
}

let audioCtx, gainNode, dest;

function initRTC() {
    if (peer) peer.close();
    peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });

    // Standard Audio/Video Track Addition (Original Behavior)
    stream.getTracks().forEach(t => peer.addTrack(t, stream));

    peer.oniceconnectionstatechange = () => {
        console.log('ICE Connection State:', peer.iceConnectionState);
        if (peer.iceConnectionState === 'disconnected' || peer.iceConnectionState === 'failed') {
            console.warn('ICE Connection failed/disconnected. Possible network issue.');
            // Phase 1: Automated restart could go here, but logging is safe step 1.
        }
    };

    peer.onicecandidate = e => { if (e.candidate) socket.emit('camera-candidate', e.candidate); };
    peer.createOffer().then(o => peer.setLocalDescription(o)).then(() => socket.emit('offer', peer.localDescription));

    // Monitor performance
    const sender = peer.getSenders().find(s => s.track && s.track.kind === 'video');
    if (sender && typeof DeviceTuner !== 'undefined') {
        DeviceTuner.startPerformanceMonitor(peer, sender, (action) => {
            if (action === 'downgrade') {
                console.log("Downgrading quality due to thermal/performance load");
                startCamera({ resolution: 720, fps: 30 }); // Drop to safe baseline
                socket.emit('log', { source: 'Camera', level: 'WARN', message: 'Thermal throttling detected. Downgraded to 720p30.' });
            }
        });
    }
}

// socket.on('set-gain') removed effectively by reverting logic
socket.on('set-gain', () => {}); // Keep empty listener to prevent socket errors from UI

socket.on('answer', a => peer && peer.setRemoteDescription(new RTCSessionDescription(a)));
socket.on('remote-candidate', c => peer && peer.addIceCandidate(new RTCIceCandidate(c)));
socket.on('request-state', async () => { 
    if(stream) {
        // Do NOT restart RTC (initRTC) here, it breaks the stream for existing viewers
        socket.emit('camera-state', state === 'RECORDING' ? 'recording' : 'idle');
        
        // Re-broadcast devices and capabilities for new remotes
        const devs = await navigator.mediaDevices.enumerateDevices();
        socket.emit('camera-devices', devs.filter(d => d.kind === 'videoinput'));
        if (track && track.getCapabilities) {
            socket.emit('camera-capabilities', track.getCapabilities());
        }
    }
});

// --- Commands ---
socket.on('switch-lens', id => startCamera({ deviceId: id }));

socket.on('control-camera', async (c) => {
    if (!track) return;
    
    // If it's a res or fps change, we must restart the stream
    if (c.resolution || c.frameRate) {
        await startCamera({ 
            resolution: c.resolution || currentSettings.resolution, 
            fps: c.frameRate || currentSettings.fps 
        });
        return;
    }

    // Update Recording Bitrate
    if (c.bitrate) {
        currentSettings.recordingBitrate = c.bitrate;
        console.log(`Bitrate set to: ${c.bitrate / 1000000} Mbps`);
    }

    try {
        const adv = {};
        if (c.zoom) adv.zoom = c.zoom;
        if (c.torch !== undefined) adv.torch = c.torch;
        if (c.focusDistance !== undefined) { adv.focusMode = 'manual'; adv.focusDistance = c.focusDistance; }
        await track.applyConstraints({ advanced: [adv] });
    } catch (e) { console.warn('Constraint failed', e); }
});

// --- Recording & Saving ---
function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    setTimeout(() => {
        a.click();
        document.body.removeChild(a);
        els.dlBtn.onclick = () => {
            const a2 = document.createElement('a');
            a2.href = url;
            a2.download = filename;
            a2.click();
        };
        els.dlBtn.classList.remove('hidden');
    }, 100);
}

socket.on('start-recording', () => {
    chunks = [];
    
    // Find best supported mimeType
    const types = [
        "video/mp4;codecs=avc1", 
        "video/mp4",
        "video/webm;codecs=vp9", 
        "video/webm;codecs=vp8", 
        "video/webm"
    ];
    const mime = types.find(t => MediaRecorder.isTypeSupported(t)) || 'video/webm';
    console.log(`Using mimeType: ${mime}`);

    // Maximize bitrate for "absolute best" quality (250 Mbps)
    const options = {
        mimeType: mime,
        videoBitsPerSecond: currentSettings.recordingBitrate, 
        audioBitsPerSecond: 320000 // 320 kbps for high fidelity audio
    };

    try {
        recorder = new MediaRecorder(stream, options);
    } catch (e) {
        console.warn('High bitrate failed, falling back to default options', e);
        recorder = new MediaRecorder(stream, { mimeType: mime });
    }
    
    // Start Upload Manager
    const ext = mime.includes('mp4') ? 'mp4' : 'webm';
    const filename = `vid_${Date.now()}.${ext}`;
    uploader.start(filename);

    recorder.ondataavailable = e => {
        if (e.data && e.data.size > 0) {
            chunks.push(e.data); // Keep local backup always (RAM permitting)
            uploader.addChunk(e.data); // Try to upload
        }
    };
    
    recorder.onstop = async () => {
        state = 'IDLE';
        
        // Finalize Upload
        const hostSaved = await uploader.stop();
        
        if (!hostSaved) {
            // Fallback: Save Locally
            console.log("Saving locally (Fallback or Default)");
            const blob = new Blob(chunks, { type: mime });
            triggerDownload(blob, filename);
        }
        
        chunks = []; // Clear memory
    };
    
    // Request data every 1 second (1000ms) to create manageable chunks for streaming
    recorder.start(1000); 
    
    state = 'RECORDING';
    els.recDot.classList.add('active');
    els.status.innerText = currentSettings.saveToHost ? "REC (USB)" : "REC";
    socket.emit('camera-state', 'recording');
});

socket.on('set-tether', (enabled) => {
    currentSettings.saveToHost = enabled;
    const msg = enabled ? "Tethered Mode: ON (Files will save to host)" : "Tethered Mode: OFF (Files will save to device)";
    console.log(msg);
    socket.emit('log', { source: 'Camera', level: 'INFO', message: msg });
});

socket.on('set-audio-mode', async (mode) => {
    // mode: 'voice' | 'pro'
    const isPro = (mode === 'pro');
    if (currentSettings.proAudio === isPro) return;

    currentSettings.proAudio = isPro;
    const msg = isPro ? "Audio: Pro Mode (Raw/High-Fi)" : "Audio: Voice Mode (Echo Cancel/Noise Supp)";
    console.log(msg);
    socket.emit('log', { source: 'Camera', level: 'INFO', message: msg });
    
    // Restart stream to apply audio constraints
    await startCamera();
});

socket.on('stop-recording', () => {
    if (recorder) recorder.stop();
    els.recDot.classList.remove('active');
    els.status.innerText = "Ready";
    socket.emit('camera-state', 'idle');
});

socket.on('take-photo', () => {
    const c = document.createElement('canvas');
    c.width = els.video.videoWidth; c.height = els.video.videoHeight;
    c.getContext('2d').drawImage(els.video, 0, 0);
    c.toBlob(b => triggerDownload(b, `img_${Date.now()}.png`), 'image/png');
});