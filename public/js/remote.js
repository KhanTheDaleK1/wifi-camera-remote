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
    fps: document.getElementById('fps-select')
};

let peer, recording = false, torchState = false;

els.btn.onclick = () => {
    els.start.classList.add('hidden');
    socket.emit('join-remote');
    socket.emit('request-state');
    els.video.play().catch(() => {});
};

socket.on('connect', () => {
    els.status.innerText = "Connected";
    socket.emit('join-remote');
});

socket.on('disconnect', () => {
    els.status.innerText = "Reconnecting...";
});

// WebRTC
socket.on('offer', async (o) => {
    if (peer) peer.close();
    peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    peer.ontrack = e => { els.video.srcObject = e.streams[0]; };
    peer.onicecandidate = e => { if (e.candidate) socket.emit('remote-candidate', e.candidate); };
    await peer.setRemoteDescription(new RTCSessionDescription(o));
    const a = await peer.createAnswer();
    await peer.setLocalDescription(a);
    socket.emit('answer', a);
});
socket.on('camera-candidate', c => peer && peer.addIceCandidate(new RTCIceCandidate(c)));

// UI Updates
socket.on('camera-devices', (devs) => {
    els.lensSelect.innerHTML = devs.map(d => `<option value="${d.deviceId}">${d.label || 'Lens'}</option>`).join('');
});

socket.on('camera-capabilities', (caps) => {
    if (caps.zoom) {
        els.zoom.min = caps.zoom.min;
        els.zoom.max = caps.zoom.max;
        els.zoom.step = caps.zoom.step;
    }
});

socket.on('camera-state', s => {
    recording = (s === 'recording');
    els.shutter.classList.toggle('recording', recording);
    els.status.innerText = recording ? "REC" : "Ready";
    els.status.style.color = recording ? "red" : "white";
});

// Control Events
els.shutter.onclick = () => socket.emit(recording ? 'stop-recording' : 'start-recording');
els.lensSelect.onchange = () => socket.emit('switch-lens', els.lensSelect.value);
els.res.onchange = () => socket.emit('control-camera', { resolution: parseInt(els.res.value) });
els.fps.onchange = () => socket.emit('control-camera', { frameRate: parseInt(els.fps.value) });
els.zoom.oninput = () => socket.emit('control-camera', { zoom: parseFloat(els.zoom.value) });
els.focus.oninput = () => socket.emit('control-camera', { focusDistance: parseFloat(els.focus.value) });
els.torch.onclick = () => {
    torchState = !torchState;
    els.torch.classList.toggle('active', torchState);
    socket.emit('control-camera', { torch: torchState });
};