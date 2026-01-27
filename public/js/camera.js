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

// Pro Settings State
let currentSettings = {
    deviceId: null,
    resolution: 1080,
    fps: 30
};

// --- Connection Recovery ---
socket.on('connect', () => {
    console.log('Socket Connected');
    socket.emit('join-camera');
    if (stream) {
        initRTC();
        socket.emit('camera-state', state === 'RECORDING' ? 'recording' : 'idle');
    }
});

els.btn.onclick = async () => {
    try {
        noSleep.enable();
        await startCamera();
        els.start.classList.add('hidden');
        els.overlay.classList.remove('hidden');
    } catch (e) { alert("Fail: " + e.message); }
};

async function startCamera(updates = {}) {
    Object.assign(currentSettings, updates);
    
    console.log('Applying Settings:', currentSettings);

    if (stream) stream.getTracks().forEach(t => t.stop());

    const constraints = {
        audio: true,
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
        socket.emit('camera-devices', devs.filter(d => d.kind === 'videoinput'));
        if (track.getCapabilities) socket.emit('camera-capabilities', track.getCapabilities());
        
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

function initRTC() {
    if (peer) peer.close();
    peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    stream.getTracks().forEach(t => peer.addTrack(t, stream));
    peer.onicecandidate = e => { if (e.candidate) socket.emit('camera-candidate', e.candidate); };
    peer.createOffer().then(o => peer.setLocalDescription(o)).then(() => socket.emit('offer', peer.localDescription));
}

socket.on('answer', a => peer && peer.setRemoteDescription(new RTCSessionDescription(a)));
socket.on('remote-candidate', c => peer && peer.addIceCandidate(new RTCIceCandidate(c)));
socket.on('request-state', () => { 
    if(stream) {
        initRTC();
        socket.emit('camera-state', state === 'RECORDING' ? 'recording' : 'idle');
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
    const mime = MediaRecorder.isTypeSupported('video/mp4') ? 'video/mp4' : 'video/webm';
    recorder = new MediaRecorder(stream, { mimeType: mime });
    recorder.ondataavailable = e => chunks.push(e.data);
    recorder.onstop = () => {
        state = 'IDLE';
        triggerDownload(new Blob(chunks, { type: mime }), `vid_${Date.now()}.mp4`);
    };
    recorder.start();
    state = 'RECORDING';
    els.recDot.classList.add('active');
    els.status.innerText = "REC";
    socket.emit('camera-state', 'recording');
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