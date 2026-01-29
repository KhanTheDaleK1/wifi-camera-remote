// camera.js - Mobile Client Wrapper for CameraSession
const socket = io({ 
    transports: ['websocket', 'polling'], 
    reconnection: true,
    autoConnect: false // Don't connect until START is clicked
});
const noSleep = new NoSleep();

const els = {
    btn: document.getElementById('start-btn'),
    start: document.getElementById('start-screen'),
    overlay: document.getElementById('camera-overlay'),
    video: document.getElementById('viewfinder'),
    status: document.getElementById('status-text'),
    recDot: document.getElementById('rec-dot'),
    dlBtn: document.getElementById('dl-btn'),
    log: document.getElementById('init-log')
};

let session = null;

// --- Wake Lock ---
let wakeLock = null;
async function requestWakeLock() {
    try {
        wakeLock = await navigator.wakeLock.request('screen');
        console.log('Screen Wake Lock active');
    } catch (err) {
        console.warn(`${err.name}, ${err.message}`);
    }
}

// --- Start Handler ---
els.btn.onclick = async () => {
    els.btn.disabled = true;
    els.btn.innerText = "INITIALIZING...";
    
    try {
        // 1. Prevent Sleep
        if ('wakeLock' in navigator) {
            await requestWakeLock();
        } else {
            noSleep.enable();
        }
        
        // 2. Connect Socket ONLY NOW
        socket.connect();
        
        // 3. Initialize Session
        session = new CameraSession(socket, els.video, els.status, els.recDot, "iPhone Camera");

        // 4. Mobile Tuning
        let startSettings = {};
        if (typeof DeviceTuner !== 'undefined') {
            try {
                const tuned = await DeviceTuner.getOptimizedConstraints();
                startSettings.resolution = tuned.height;
                startSettings.fps = tuned.frameRate;
            } catch (e) {
                console.warn("Tuner failed", e);
            }
        }

        // 5. Start Media
        await session.start(startSettings);
        
        els.start.classList.add('hidden');
        els.overlay.classList.remove('hidden');

    } catch (e) { 
        alert("Camera Error: " + e.message); 
        console.error(e);
        els.btn.disabled = false;
        els.btn.innerText = "START CAMERA";
    }
};