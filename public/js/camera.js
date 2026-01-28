// camera.js - Mobile Client Wrapper for CameraSession
const socket = io({ transports: ['polling'], reconnection: true });
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

// Create Session
// We pass the global socket so it reuses the connection established by the page
const session = new CameraSession(socket, els.video, els.status, els.recDot);

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

// --- Start Handler ---
els.btn.onclick = async () => {
    try {
        // 1. Prevent Sleep
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
        
        // 2. Mobile Tuning
        let startSettings = {};
        if (typeof DeviceTuner !== 'undefined') {
            try {
                const tuned = await DeviceTuner.getOptimizedConstraints();
                console.log("Applying Tuned Profile:", tuned);
                startSettings.resolution = tuned.height;
                startSettings.fps = tuned.frameRate;
            } catch (e) {
                console.warn("Tuner failed, using defaults", e);
            }
        }

        // 3. Start Session
        await session.start(startSettings);
        
        els.start.classList.add('hidden');
        els.overlay.classList.remove('hidden');

    } catch (e) { 
        alert("Fail: " + e.message); 
        console.error(e);
    }
};

// --- Download Button Handler (Legacy Fallback) ---
// CameraSession handles uploads, but if it falls back to local blob download, 
// it creates a link. If we want a persistent button:
// (CameraSession currently appends a temporary link. We can enhance this later if needed.)
