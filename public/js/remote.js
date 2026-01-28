const socket = io({ 
    transports: ['polling'],
    reconnection: true
});

const els = {
    btn: document.getElementById('connect-btn'),
    start: document.getElementById('remote-start'),
    video: document.getElementById('remote-video'),
    status: document.getElementById('status'),
    shutter: document.getElementById('shutter'),
    lensSelect: document.getElementById('lens-select'),
    zoom: document.getElementById('zoom-slider'),
    focus: document.getElementById('focus-slider'),
    torch: document.getElementById('torch-btn'),
    res: document.getElementById('res-select'),
    fps: document.getElementById('fps-select'),
    camSelect: document.getElementById('cam-select'),
    tetherBtn: document.getElementById('tether-btn'),
    audioBtn: document.getElementById('audio-btn'),
    trackSelect: document.getElementById('track-select')
};

let peer, recording = false, torchState = false;
let activeCamId = null;
let tetherState = false;
let audioState = false; // false = voice, true = pro
let trackMode = 'off';

// Check URL params for target camera
const urlParams = new URLSearchParams(window.location.search);
const targetCamId = urlParams.get('cam');
if (targetCamId) {
    console.log(`[Remote] Auto-targeting camera: ${targetCamId}`);
}

// --- UI Interaction ---
els.btn.onclick = () => {
    els.start.classList.add('hidden');
    socket.emit('join-remote');
    els.video.play().catch(() => {});
};

function sendCmd(cmd, payload = {}) {
    if (!activeCamId) return;
    socket.emit(cmd, { target: activeCamId, payload });
}

// --- Connection ---
socket.on('connect', () => {
    els.status.innerText = "Connected";
    socket.emit('join-remote');
});

socket.on('disconnect', () => {
    els.status.innerText = "Reconnecting...";
    if (peer) peer.close();
});

// --- Camera Selection ---
socket.on('camera-list', (cameras) => {
    const savedId = activeCamId;
    els.camSelect.innerHTML = cameras.map(c => `<option value="${c.id}">${c.meta.name || c.id.substr(0,4)}</option>`).join('');
    
    if (cameras.length > 0) {
        // Priority 1: URL Parameter (First load)
        if (targetCamId && cameras.find(c => c.id === targetCamId)) {
             if (activeCamId !== targetCamId) {
                 activeCamId = targetCamId;
                 els.camSelect.value = activeCamId;
                 connectToCamera(activeCamId);
                 
                 // Auto-hide start screen if deep-linked
                 if (!els.start.classList.contains('hidden')) {
                     els.start.classList.add('hidden');
                     els.video.play().catch(() => {});
                 }
             }
        }
        // Priority 2: Restore previous selection
        else if (savedId && cameras.find(c => c.id === savedId)) {
            els.camSelect.value = savedId;
        } 
        // Priority 3: Default to first
        else {
            if (!activeCamId) { // Only change if we have nothing selected
                activeCamId = cameras[0].id;
                els.camSelect.value = activeCamId;
                connectToCamera(activeCamId);
            }
        }
    } else {
        els.camSelect.innerHTML = '<option>No Cameras</option>';
        activeCamId = null;
    }
});

socket.on('camera-joined', () => socket.emit('join-remote')); 
socket.on('camera-left', () => socket.emit('join-remote'));

els.camSelect.onchange = () => {
    activeCamId = els.camSelect.value;
    connectToCamera(activeCamId);
};

function connectToCamera(id) {
    if (peer) peer.close();
    socket.emit('request-state', { target: id });
    // Restore states
    sendCmd('set-tether', tetherState);
    sendCmd('set-audio-mode', audioState ? 'pro' : 'voice');
    sendCmd('set-track-mode', trackMode);
}

// --- WebRTC Logic (Multi-Cam Aware) ---
socket.on('offer', async (data) => {
    if (data.from !== activeCamId) return; // Ignore other cameras

    if (peer) peer.close();
    peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    
    peer.ontrack = e => { els.video.srcObject = e.streams[0]; };
    peer.onicecandidate = e => { 
        if (e.candidate) socket.emit('remote-candidate', { target: activeCamId, payload: e.candidate }); 
    };

    await peer.setRemoteDescription(new RTCSessionDescription(data.payload));
    const a = await peer.createAnswer();
    await peer.setLocalDescription(a);
    socket.emit('answer', { target: activeCamId, payload: a });
});

socket.on('camera-candidate', (data) => {
    if (data.from === activeCamId && peer) {
        peer.addIceCandidate(new RTCIceCandidate(data.payload));
    }
});

// --- State & UI Updates ---
socket.on('camera-devices', (d) => {
    if (d.from !== activeCamId) return;
    els.lensSelect.innerHTML = d.payload.map(x => `<option value="${x.deviceId}">${x.label || 'Lens'}</option>`).join('');
});

socket.on('camera-capabilities', (d) => {
    if (d.from !== activeCamId) return;
    const caps = d.payload;
    if (caps.zoom) {
        els.zoom.min = caps.zoom.min;
        els.zoom.max = caps.zoom.max;
        els.zoom.step = caps.zoom.step;
    }
});

socket.on('camera-state', d => {
    if (d.from !== activeCamId) return;
    recording = (d.payload === 'recording');
    els.shutter.classList.toggle('recording', recording);
    els.status.innerText = recording ? "REC" : "Ready";
    els.status.style.color = recording ? "red" : "white";
});

// --- Controls ---
els.shutter.onclick = () => sendCmd(recording ? 'stop-recording' : 'start-recording');

els.tetherBtn.onclick = () => {
    tetherState = !tetherState;
    els.tetherBtn.innerText = tetherState ? "USB SAVE: ON" : "USB SAVE: OFF";
    els.tetherBtn.style.background = tetherState ? "#0a84ff" : "#333";
    sendCmd('set-tether', tetherState);
};

els.audioBtn.onclick = () => {
    audioState = !audioState;
    els.audioBtn.innerText = audioState ? "MIC: PRO" : "MIC: VOICE";
    els.audioBtn.style.background = audioState ? "#0a84ff" : "#333";
    sendCmd('set-audio-mode', audioState ? 'pro' : 'voice');
};

els.trackSelect.onchange = () => {
    trackMode = els.trackSelect.value;
    sendCmd('set-track-mode', trackMode);
};

els.lensSelect.onchange = () => sendCmd('switch-lens', els.lensSelect.value);
els.res.onchange = () => sendCmd('control-camera', { resolution: parseInt(els.res.value) });
els.fps.onchange = () => sendCmd('control-camera', { frameRate: parseInt(els.fps.value) });
els.zoom.oninput = () => sendCmd('control-camera', { zoom: parseFloat(els.zoom.value) });
els.focus.oninput = () => sendCmd('control-camera', { focusDistance: parseFloat(els.focus.value) });
els.torch.onclick = () => {
    torchState = !torchState;
    els.torch.classList.toggle('active', torchState);
    sendCmd('control-camera', { torch: torchState });
};
