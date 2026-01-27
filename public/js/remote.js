const socket = io();
setupRemoteLogging(socket, 'Remote');

const remoteView = document.getElementById('remote-view');
const statusDisplay = document.getElementById('status-display');
const shutterBtn = document.getElementById('shutter-btn');
const photoBtn = document.getElementById('photo-btn');
const torchBtn = document.getElementById('torch-btn');
const zoomSlider = document.getElementById('zoom-slider');
const switchCamBtn = document.getElementById('switch-cam-btn');
const resSelect = document.getElementById('resolution-select');
const fpsSelect = document.getElementById('framerate-select');
const lensSelect = document.getElementById('lens-select');
const exposureSlider = document.getElementById('exposure-slider');
const focusSlider = document.getElementById('focus-slider');

let peerConnection;
let isRecording = false;
let torchState = false;

// WebRTC Configuration
const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
    ]
};

// Join as remote
socket.emit('join-remote');
socket.emit('get-devices');

// --- Event Listeners ---

shutterBtn.addEventListener('click', () => {
    if (!isRecording) {
        socket.emit('trigger-record');
    } else {
        socket.emit('trigger-stop');
    }
});

photoBtn.addEventListener('click', () => {
    socket.emit('trigger-photo');
    // Visual feedback
    photoBtn.style.transform = "scale(0.9)";
    setTimeout(() => photoBtn.style.transform = "scale(1)", 100);
});

torchBtn.addEventListener('click', () => {
    torchState = !torchState;
    socket.emit('control-camera', { torch: torchState });
    torchBtn.classList.toggle('active', torchState);
});

// Pro Controls
lensSelect.addEventListener('change', () => {
    if (lensSelect.value) {
        socket.emit('switch-lens', lensSelect.value);
    }
});

exposureSlider.addEventListener('input', (e) => {
    socket.emit('control-camera', { exposureCompensation: parseFloat(e.target.value) });
});

focusSlider.addEventListener('input', (e) => {
    socket.emit('control-camera', { focusMode: 'manual', focusDistance: parseFloat(e.target.value) });
});

switchCamBtn.addEventListener('click', () => {
    socket.emit('switch-camera');
});

resSelect.addEventListener('change', () => {
    socket.emit('control-camera', { resolution: resSelect.value });
});

fpsSelect.addEventListener('change', () => {
    socket.emit('control-camera', { frameRate: fpsSelect.value });
});

// --- WebRTC Logic ---

socket.on('offer', async (offer) => {
    if (peerConnection) peerConnection.close();
    
    peerConnection = new RTCPeerConnection(rtcConfig);
    
    peerConnection.ontrack = (event) => {
        remoteView.srcObject = event.streams[0];
    };
    
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('remote-candidate', event.candidate);
        }
    };
    
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    
    socket.emit('answer', answer);
});

socket.on('camera-candidate', async (candidate) => {
    if (peerConnection) {
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
            console.error('Error adding received ice candidate', e);
        }
    }
});

// --- Status & Capability Updates ---

socket.on('status-update', (status) => {
    if (status === 'recording') {
        isRecording = true;
        shutterBtn.classList.add('recording');
        statusDisplay.innerText = 'REC ●';
        statusDisplay.style.color = 'var(--accent-red)';
    } else if (status === 'standby') {
        isRecording = false;
        shutterBtn.classList.remove('recording');
        statusDisplay.innerText = 'Ready';
        statusDisplay.style.color = 'var(--accent-green)';
    } else if (status === 'saving') {
        statusDisplay.innerText = 'Saving...';
        statusDisplay.style.color = 'var(--accent-blue)';
    }
});

socket.on('camera-capabilities', (caps) => {
    if (caps.zoom) {
        zoomSlider.disabled = false;
        zoomSlider.min = caps.zoom.min;
        zoomSlider.max = caps.zoom.max;
        zoomSlider.step = caps.zoom.step;
    } else {
        zoomSlider.disabled = true;
    }

    if (caps.torch) {
        torchBtn.disabled = false;
    } else {
        torchBtn.disabled = true;
        torchBtn.style.opacity = 0.5;
    }
});

socket.on('camera-devices', (devices) => {
    lensSelect.innerHTML = '<option value="" disabled selected>Lens...</option>';
    devices.forEach(device => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.text = device.label || `Camera ${device.deviceId.substr(0, 5)}...`;
        lensSelect.appendChild(option);
    });
});

socket.on('connect', () => {
    statusDisplay.innerText = 'Connected';
});

socket.on('disconnect', () => {
    statusDisplay.innerText = 'Disconnected';
    statusDisplay.style.color = 'gray';
});