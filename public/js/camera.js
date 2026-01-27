const socket = io();
setupRemoteLogging(socket, 'Camera');

const viewfinder = document.getElementById('viewfinder');
const statusText = document.getElementById('status-text');
const recDot = document.getElementById('rec-dot');
const downloadBtn = document.getElementById('download-btn');

let mediaRecorder;
let recordedChunks = [];
let stream = null;
let peerConnection;
let currentFacingMode = 'environment';
let track;
const noSleep = new NoSleep();

const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
    ]
};

// Initialize Camera
async function initCamera(specificDeviceId = null) {
    // Enable NoSleep on first touch to keep screen on
    document.addEventListener('click', function enableNoSleep() {
        noSleep.enable();
        document.removeEventListener('click', enableNoSleep);
    }, { once: true });


    try {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }

        const constraints = {
            audio: true,
            video: {}
        };

        if (specificDeviceId) {
            constraints.video.deviceId = { exact: specificDeviceId };
        } else {
            // Default to environment if not specified
            constraints.video.facingMode = currentFacingMode || 'environment';
        }
        
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        viewfinder.srcObject = stream;
        
        // Force play
        try {
            await viewfinder.play();
        } catch (playErr) {
            updateStatus('Play Error: ' + playErr.message);
        }
        
        // Get video track for capabilities
        const videoTrack = stream.getVideoTracks()[0];
        track = videoTrack;
        
        // Debug Info
        const settings = videoTrack.getSettings();
        const debugText = `Cam: ${settings.deviceId ? settings.deviceId.substr(0,4) : 'Def'} | Res: ${settings.width}x${settings.height} | State: ${videoTrack.readyState}`;
        console.log(debugText); // Keep for remote debug if needed
        
        // Append to status for visibility
        updateStatus('Standby');
        const debugEl = document.createElement('div');
        debugEl.style.fontSize = '10px';
        debugEl.style.color = '#555';
        debugEl.innerText = debugText;
        document.querySelector('.status-overlay').appendChild(debugEl);
        
        // Broadcast capabilities
        let capabilities = {};
        try {
            capabilities = videoTrack.getCapabilities ? videoTrack.getCapabilities() : {};
        } catch (e) {
            console.error('Could not get caps', e);
        }

        // iOS fallback: iOS often doesn't report zoom/torch via getCapabilities but supports them.
        // We force-report them so the remote UI enables the controls.
        if (!capabilities.zoom) {
            capabilities.zoom = { min: 1, max: 10, step: 0.1 };
        }
        if (!capabilities.torch && typeof capabilities.torch === 'undefined') {
            // Assume torch might be available
            capabilities.torch = true; 
        }

        socket.emit('camera-capabilities', {
            zoom: capabilities.zoom,
            torch: capabilities.torch
        });
        
        // Enumerate Devices (Lenses)
        await broadcastDevices();
        
        socket.emit('join-camera');
        updateStatus('Standby');
        
        // Initiate WebRTC Stream
        startWebRTC();
        
    } catch (err) {
        console.error('Camera Error:', err);
        updateStatus('Error: ' + err.message);
        socket.emit('camera-error', err.message);
    }
}

async function broadcastDevices() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(device => device.kind === 'videoinput');
        socket.emit('camera-devices', videoDevices);
    } catch (e) {
        console.error('Error enumerating devices:', e);
    }
}

// Start WebRTC Streaming
async function startWebRTC() {
    if (peerConnection) peerConnection.close();
    
    peerConnection = new RTCPeerConnection(rtcConfig);
    
    // Add tracks to connection
    stream.getTracks().forEach(track => {
        peerConnection.addTrack(track, stream);
    });
    
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('camera-candidate', event.candidate);
        }
    };
    
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('offer', offer);
}

socket.on('answer', async (answer) => {
    if (peerConnection) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    }
});

socket.on('remote-candidate', async (candidate) => {
    if (peerConnection) {
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
            console.error('Error adding remote ice candidate', e);
        }
    }
});


// Recording Logic
function startRecording() {
    if (!stream) return;
    
    recordedChunks = [];
    const mimeTypes = ['video/webm;codecs=vp8,opus', 'video/mp4', 'video/webm'];
    let options = {};
    for (let type of mimeTypes) {
        if (MediaRecorder.isTypeSupported(type)) {
            options = { mimeType: type };
            break;
        }
    }

    try {
        mediaRecorder = new MediaRecorder(stream, options);
    } catch (e) {
        mediaRecorder = new MediaRecorder(stream);
    }

    mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordedChunks.push(event.data);
    };

    mediaRecorder.onstop = saveVideo;

    mediaRecorder.start();
    updateStatus('Recording');
    recDot.classList.add('active');
    socket.emit('camera-status', 'recording');
    
    downloadBtn.classList.remove('visible');
    downloadBtn.href = '#';
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        updateStatus('Saving...');
        recDot.classList.remove('active');
        socket.emit('camera-status', 'saving');
    }
}

function saveVideo() {
    const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'video/webm' });
    const url = URL.createObjectURL(blob);
    const filename = `rec_${Date.now()}.mp4`; // Keep simple extension
    
    downloadBtn.href = url;
    downloadBtn.download = filename;
    downloadBtn.classList.add('visible');
    downloadBtn.innerText = 'Tap to Save Video';
    
    updateStatus('Standby');
    socket.emit('camera-status', 'standby');
}

// Photo Logic
function takePhoto() {
    // Canvas Fallback method (more reliable for live view capture)
    const canvas = document.createElement('canvas');
    canvas.width = viewfinder.videoWidth;
    canvas.height = viewfinder.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(viewfinder, 0, 0);
    
    canvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `photo_${Date.now()}.png`;
        a.click(); // This works on many mobile browsers if user interaction recently happened, but might fail without explicit touch.
        // If it fails, we might need a UI button "Download Photo" similar to video.
        
        // Show temporary message
        const originalText = statusText.innerText;
        updateStatus('Photo Saved!');
        setTimeout(() => updateStatus(originalText), 1500);
    }, 'image/png');
}

function updateStatus(text) {
    statusText.innerText = text;
}

// Socket Events for Controls
socket.on('start-recording', startRecording);
socket.on('stop-recording', stopRecording);
socket.on('take-photo', takePhoto);

socket.on('request-status', () => {
    const status = (mediaRecorder && mediaRecorder.state === 'recording') ? 'recording' : 'standby';
    socket.emit('camera-status', status);
});

socket.on('apply-constraints', async (constraints) => {
    if (!track) return;
    
    // Map custom resolution/fps strings to actual constraints
    const advanced = {};
    
    if (constraints.resolution) {
        if (constraints.resolution === '4K') {
            advanced.width = { ideal: 3840 };
            advanced.height = { ideal: 2160 };
        } else if (constraints.resolution === '1080p') {
            advanced.width = { ideal: 1920 };
            advanced.height = { ideal: 1080 };
        } else if (constraints.resolution === '720p') {
            advanced.width = { ideal: 1280 };
            advanced.height = { ideal: 720 };
        }
    }

    if (constraints.frameRate) {
        advanced.frameRate = { ideal: parseInt(constraints.frameRate) };
    }
    
    // Pass through other constraints like torch/zoom
    if (typeof constraints.zoom !== 'undefined') advanced.zoom = constraints.zoom;
    if (typeof constraints.torch !== 'undefined') advanced.torch = constraints.torch;

    // Pro Controls
    if (typeof constraints.exposureCompensation !== 'undefined') {
        advanced.exposureMode = 'continuous'; // or manual
        advanced.exposureCompensation = constraints.exposureCompensation;
    }
    
    if (constraints.focusMode === 'manual') {
        advanced.focusMode = 'manual';
        if (typeof constraints.focusDistance !== 'undefined') {
             advanced.focusDistance = constraints.focusDistance;
        }
    }

    try {
        await track.applyConstraints({ advanced: [advanced] });
    } catch (err) {
        console.error('Error applying constraints:', err);
    }
});

socket.on('switch-camera', () => {
    currentFacingMode = (currentFacingMode === 'user') ? 'environment' : 'user';
    initCamera(); // Re-init with new mode
});

socket.on('switch-lens', (deviceId) => {
    // Override facing mode if specific device selected
    initCamera(deviceId);
});

socket.on('get-devices', () => {
    broadcastDevices();
});

socket.on('connect', () => {
    // Re-connected
});

// Initialize
initCamera();