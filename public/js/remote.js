const socket = io({ 
    transports: ['websocket', 'polling'],
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
    trackSelect: document.getElementById('track-select'),
    flipBtn: document.querySelector('button[onclick*="switch-camera"]')
};

let peer, recording = false, torchState = false;
let activeCamId = null;
let tetherState = false;
let audioState = false; 
let trackMode = 'off';
let connectionTimeout = null;

// --- UI Interaction ---
if (els.btn) {
    els.btn.onclick = () => {
        els.start.classList.add('hidden');
        socket.emit('join-remote');
        els.video.play().catch(() => {});
    };
}

// Intercept the inline flip button
if (els.flipBtn) {
    els.flipBtn.onclick = (e) => {
        e.preventDefault();
        sendCmd('switch-camera');
    };
}

function sendCmd(cmd, payload = {}) {
    if (!activeCamId) return;
    socket.emit(cmd, { target: activeCamId, payload });
}

socket.on('connect', () => {
    els.status.innerText = "Connected";
    socket.emit('join-remote');
});

// --- Camera Selection ---
socket.on('camera-list', (cameras) => {
    const uniqueCams = [];
    const seen = new Set();
    cameras.forEach(c => {
        if (!seen.has(c.id)) {
            seen.add(c.id);
            uniqueCams.push(c);
        }
    });

    els.camSelect.innerHTML = uniqueCams.map(c => `<option value="${c.id}">${c.meta.name || c.id.substr(0,4)}</option>`).join('');
    
    if (uniqueCams.length > 0) {
        if (!activeCamId || !uniqueCams.find(c => c.id === activeCamId)) { 
            activeCamId = uniqueCams[0].id;
            els.camSelect.value = activeCamId;
            connectToCamera(activeCamId);
        }
    } else {
        els.camSelect.innerHTML = '<option>No Cameras Online</option>';
        activeCamId = null;
        els.status.innerText = "Waiting for Camera...";
    }
});

socket.on('camera-joined', () => {
    if (!activeCamId) socket.emit('join-remote');
});

socket.on('camera-left', (d) => {
    if (d.id === activeCamId) {
        els.status.innerText = "Camera Disconnected";
        if (peer) peer.close();
        activeCamId = null;
    }
    socket.emit('join-remote');
});

els.camSelect.onchange = () => {
    activeCamId = els.camSelect.value;
    connectToCamera(activeCamId);
};

function connectToCamera(id) {
    if (peer) { peer.close(); peer = null; }
    els.status.innerText = "Requesting Stream...";
    els.status.style.color = "white";
    
    if (connectionTimeout) clearTimeout(connectionTimeout);
    connectionTimeout = setTimeout(() => {
        if (els.status.innerText === "Requesting Stream...") {
            els.status.innerHTML = `Not Responding <button onclick="connectToCamera('${id}')" style="font-size:9px; padding:2px 4px;">Retry</button>`;
            els.status.style.color = "#ff9f0a";
        }
    }, 8000);

    socket.emit('request-state', { target: id });
    sendCmd('set-tether', tetherState);
    sendCmd('set-audio-mode', audioState ? 'pro' : 'voice');
    sendCmd('set-track-mode', trackMode);
}

// --- WebRTC Logic ---
socket.on('offer', async (data) => {
    if (data.from !== activeCamId) return; 
    if (connectionTimeout) clearTimeout(connectionTimeout);
    els.status.innerText = "Negotiating...";

    if (peer) peer.close();
    peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    
    peer.oniceconnectionstatechange = () => {
        if (peer.iceConnectionState === 'connected' || peer.iceConnectionState === 'completed') {
            els.status.innerText = "Live";
            els.status.style.color = "#00cc00";
        }
    };

    peer.ontrack = async (e) => { 
        els.video.srcObject = e.streams[0]; 
        els.video.play().catch(() => {});
    };
    
    peer.onicecandidate = e => { 
        if (e.candidate) socket.emit('remote-candidate', { target: activeCamId, payload: e.candidate }); 
    };

    try {
        await peer.setRemoteDescription(new RTCSessionDescription(data.payload));
        const a = await peer.createAnswer();
        await peer.setLocalDescription(a);
        socket.emit('answer', { target: activeCamId, payload: a });
    } catch (e) {
        els.status.innerText = "Signal Error";
    }
});

socket.on('camera-candidate', (data) => {
    if (data.from === activeCamId && peer) {
        peer.addIceCandidate(new RTCIceCandidate(data.payload)).catch(() => {});
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
    const payload = d.payload;
    if (typeof payload === 'object') {
        recording = (payload.state === 'recording');
        if (payload.settings) {
            if (payload.settings.resolution) els.res.value = payload.settings.resolution;
            if (payload.settings.fps) els.fps.value = payload.settings.fps;
        }
    } else {
        recording = (payload === 'recording');
    }
    els.shutter.classList.toggle('recording', recording);
    els.status.innerText = recording ? "REC" : "Live";
    els.status.style.color = recording ? "red" : "#00cc00";
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
    els.audioBtn.innerText = audioState ? "MIC: HI-FI" : "MIC: VOICE";
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
els.zoom.oninput = () => {
    document.getElementById('zoom-val').innerText = parseFloat(els.zoom.value).toFixed(1);
    sendCmd('control-camera', { zoom: parseFloat(els.zoom.value) });
};
els.focus.oninput = () => sendCmd('control-camera', { focusDistance: parseFloat(els.focus.value) });
els.torch.onclick = () => {
    torchState = !torchState;
    els.torch.classList.toggle('active', torchState);
    sendCmd('control-camera', { torch: torchState });
};