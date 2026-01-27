const socket = io({ transports: ['polling', 'websocket'] });
window.Logger.init(socket, 'Remote');

const els = {
    video: document.getElementById('remote-video'),
    status: document.getElementById('status'),
    lensSelect: document.getElementById('lens-select'),
    shutter: document.getElementById('shutter')
};

let peer = null;
let recording = false;

// --- 1. Connection & Setup ---
socket.on('connect', () => {
    els.status.innerText = 'Connected';
    socket.emit('join-remote');
    socket.emit('get-devices'); // Ask for the lens list immediately
});

socket.on('disconnect', () => els.status.innerText = 'Disconnected');

// --- 2. WebRTC Handling ---
const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

socket.on('offer', async (offer) => {
    if (peer) peer.close();
    peer = new RTCPeerConnection(rtcConfig);
    
    peer.ontrack = e => {
        els.video.srcObject = e.streams[0];
    };
    
    peer.onicecandidate = e => {
        if (e.candidate) socket.emit('remote-candidate', e.candidate);
    };
    
    await peer.setRemoteDescription(offer);
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    
    socket.emit('answer', answer);
});

socket.on('camera-candidate', c => peer && peer.addIceCandidate(c));


// --- 3. UI Updates ---
socket.on('camera-devices', (devs) => {
    els.lensSelect.innerHTML = '<option value="" disabled selected>Lens...</option>';
    devs.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.innerText = d.label || d.deviceId.substr(0, 8);
        els.lensSelect.appendChild(opt);
    });
});

socket.on('camera-state', (state) => {
    recording = (state === 'recording');
    if (recording) els.shutter.classList.add('recording');
    else els.shutter.classList.remove('recording');
});


// --- 4. Controls ---
els.shutter.addEventListener('click', () => {
    if (recording) socket.emit('stop-recording');
    else socket.emit('start-recording');
});
