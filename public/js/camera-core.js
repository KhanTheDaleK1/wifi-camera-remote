// --- Robust Upload Manager ---
class UploadManager {
    constructor(socket, statusCallback) {
        this.socket = socket;
        this.statusCallback = statusCallback || (() => {});
        this.queue = [];
        this.isUploading = false;
        this.fallbackMode = false;
        this.filename = null;
        this.totalSize = 0;
        this.saveToHost = false; // Controlled by settings
    }

    start(filename, saveToHost) {
        this.filename = filename;
        this.saveToHost = saveToHost;
        this.queue = [];
        this.isUploading = false;
        this.fallbackMode = false;
        this.totalSize = 0;
        
        if (this.saveToHost && this.socket.connected) {
            console.log("UploadManager: Starting Tethered Upload...");
            this.socket.emit('start-upload', { filename }, (response) => {
                if (!response || !response.success) {
                    console.warn("UploadManager: Server rejected. Fallback.");
                    this.fallbackMode = true;
                    this.statusCallback("REC (Local)");
                } else {
                    this.statusCallback("REC (USB)");
                }
            });
        } else {
            this.fallbackMode = true; 
        }
    }

    addChunk(chunk) {
        this.queue.push(chunk);
        this.totalSize += chunk.size;
        if (!this.fallbackMode && this.saveToHost) this.processQueue();
    }

    processQueue() {
        if (this.isUploading || this.queue.length === 0 || this.fallbackMode) return;

        this.isUploading = true;
        const chunk = this.queue[0]; 

        this.socket.emit('upload-chunk', chunk, (ack) => {
            if (ack && ack.success) {
                this.queue.shift();
                this.isUploading = false;
                if (this.queue.length > 0) this.processQueue();
            } else {
                this.triggerFallback();
            }
        });
        
        setTimeout(() => {
            if (this.isUploading) {
                 console.warn("UploadManager: Timeout. Fallback.");
                 this.triggerFallback();
            }
        }, 3000);
    }

    triggerFallback() {
        this.fallbackMode = true;
        this.isUploading = false;
        this.socket.emit('cancel-upload'); 
        this.statusCallback("REC (Fallback)");
        this.socket.emit('log', { source: 'Camera', level: 'WARN', message: 'Network drop. Saving locally.' });
    }

    async stop() {
        if (!this.fallbackMode && this.saveToHost) {
            if (this.queue.length > 0) {
                 this.statusCallback("Finishing...");
            }
            // Simple logic: if queue empty, we are good.
            if (this.queue.length === 0) {
                this.socket.emit('end-upload');
                this.statusCallback("Saved to Host");
                this.socket.emit('log', { source: 'Camera', level: 'SUCCESS', message: `Offloaded ${this.filename}` });
                return true; 
            }
        }
        return false; 
    }
}

// --- AI Smart Tracker ---
class SmartTracker {
    constructor() {
        this.models = { face: null, object: null };
        this.mode = 'off'; 
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.isActive = false;
        this.animationId = null;
        this.vCam = { x: 0, y: 0, w: 1920, h: 1080 };
        this.target = { x: 0, y: 0, w: 1920, h: 1080 };
        this.lerpFactor = 0.05;
        this.padding = 0.4;
        this.noDetectionFrames = 0;
    }

    async load() {
        if (!this.models.face && window.blazeface) this.models.face = await blazeface.load();
        if (!this.models.object && window.cocoSsd) this.models.object = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
    }

    setMode(mode) { this.mode = mode; }

    start(videoEl, originalStream) {
        if (this.mode === 'off') return originalStream;
        this.isActive = true;
        this.video = videoEl;
        const s = originalStream.getVideoTracks()[0].getSettings();
        this.canvas.width = s.width || 1920;
        this.canvas.height = s.height || 1080;
        this.vCam = { x: 0, y: 0, w: this.canvas.width, h: this.canvas.height };
        this.target = { ...this.vCam };
        this.loop();
        return this.canvas.captureStream(s.frameRate || 30);
    }

    stop() {
        this.isActive = false;
        if (this.animationId) cancelAnimationFrame(this.animationId);
    }

    async loop() {
        if (!this.isActive) return;
        let detectedBox = null;

        if (this.mode === 'face' && this.models.face) {
            try {
                const faces = await this.models.face.estimateFaces(this.video, false);
                if (faces.length > 0) {
                    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                    faces.forEach(f => {
                        const s = f.topLeft; const e = f.bottomRight;
                        minX = Math.min(minX, s[0]); minY = Math.min(minY, s[1]);
                        maxX = Math.max(maxX, e[0]); maxY = Math.max(maxY, e[1]);
                    });
                    detectedBox = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
                }
            } catch (e) {}
        } 
        else if ((this.mode === 'body' || this.mode === 'object') && this.models.object) {
            try {
                const preds = await this.models.object.detect(this.video);
                const candidates = preds.filter(p => p.score > 0.5);
                let target = null;
                if (this.mode === 'body') {
                    const people = candidates.filter(p => p.class === 'person');
                    people.sort((a,b) => (b.bbox[2]*b.bbox[3]) - (a.bbox[2]*a.bbox[3]));
                    if (people.length > 0) target = people[0];
                } else {
                    const objects = candidates.filter(p => p.class !== 'person');
                    objects.sort((a,b) => (b.bbox[2]*b.bbox[3]) - (a.bbox[2]*a.bbox[3]));
                    if (objects.length > 0) target = objects[0];
                }
                if (target) { const [x, y, w, h] = target.bbox; detectedBox = { x, y, w, h }; }
            } catch (e) {}
        }

        if (detectedBox) {
            this.noDetectionFrames = 0;
            const { x, y, w, h } = detectedBox;
            const cx = x + w/2; const cy = y + h/2;
            let targetH = Math.max(h * (1 + this.padding * 2), this.canvas.height * 0.25);
            targetH = Math.min(targetH, this.canvas.height);
            let targetW = targetH * (this.canvas.width / this.canvas.height);
            let targetX = Math.max(0, Math.min(cx - targetW / 2, this.canvas.width - targetW));
            let targetY = Math.max(0, Math.min(cy - targetH / 2, this.canvas.height - targetH));
            this.target = { x: targetX, y: targetY, w: targetW, h: targetH };
            this.lerpFactor = 0.08;
        } else {
            this.noDetectionFrames++;
            if (this.noDetectionFrames > 45) {
                this.target = { x: 0, y: 0, w: this.canvas.width, h: this.canvas.height };
                this.lerpFactor = 0.03;
            }
        }

        this.vCam.x += (this.target.x - this.vCam.x) * this.lerpFactor;
        this.vCam.y += (this.target.y - this.vCam.y) * this.lerpFactor;
        this.vCam.w += (this.target.w - this.vCam.w) * this.lerpFactor;
        this.vCam.h += (this.target.h - this.vCam.h) * this.lerpFactor;

        this.ctx.drawImage(this.video, this.vCam.x, this.vCam.y, this.vCam.w, this.vCam.h, 0, 0, this.canvas.width, this.canvas.height);
        this.animationId = requestAnimationFrame(() => this.loop());
    }
}

// --- MAIN CAMERA SESSION CLASS ---
class CameraSession {
    constructor(socket, videoEl, statusEl, recEl, nameOverride) {
        this.socket = socket;
        this.videoEl = videoEl;
        this.statusEl = statusEl;
        this.recEl = recEl;
        this.name = nameOverride || 'Camera';

        this.stream = null;
        this.recorder = null;
        this.peer = null;
        this.track = null;
        this.chunks = [];
        this.state = 'IDLE';

        this.uploader = new UploadManager(socket, (msg) => { if(this.statusEl) this.statusEl.innerText = msg; });
        this.tracker = new SmartTracker();

        this.settings = {
            deviceId: null,
            resolution: 1080,
            fps: 30,
            recordingBitrate: 250000000,
            saveToHost: false,
            proAudio: false,
            trackMode: 'off'
        };

        this.initSocket();
    }

    initSocket() {
        this.socket.on('connect', () => {
            console.log(`[${this.name}] Socket Connected`);
            this.socket.emit('join-camera', { name: this.name });
            this.tracker.load().catch(e => console.warn("AI Load Failed:", e));
            if (this.stream) {
                this.initRTC();
                this.socket.emit('camera-state', this.state === 'RECORDING' ? 'recording' : 'idle');
            }
        });

        // Command Listeners
        this.socket.on('switch-lens', id => this.start({ deviceId: id }));
        this.socket.on('set-tether', e => { 
            this.settings.saveToHost = e; 
            this.log(e ? "Tether ON" : "Tether OFF");
        });
        this.socket.on('set-audio-mode', async m => {
            const isPro = (m === 'pro');
            if (this.settings.proAudio === isPro) return;
            this.settings.proAudio = isPro;
            this.log(isPro ? "Audio: Pro" : "Audio: Voice");
            await this.start();
        });
        this.socket.on('set-track-mode', async m => {
            if (this.settings.trackMode === m) return;
            this.settings.trackMode = m;
            this.log(`Tracking: ${m}`);
            await this.start();
        });
        this.socket.on('control-camera', async c => {
            if (c.resolution || c.frameRate) await this.start({ resolution: c.resolution || this.settings.resolution, fps: c.frameRate || this.settings.fps });
            if (c.bitrate) this.settings.recordingBitrate = c.bitrate;
            // Advanced constraints
            if (this.track) {
                try {
                    const adv = {};
                    if (c.zoom) adv.zoom = c.zoom;
                    if (c.torch !== undefined) adv.torch = c.torch;
                    if (c.focusDistance !== undefined) { adv.focusMode = 'manual'; adv.focusDistance = c.focusDistance; }
                    await this.track.applyConstraints({ advanced: [adv] });
                } catch(e) {}
            }
        });
        this.socket.on('start-recording', () => this.startRecording());
        this.socket.on('stop-recording', () => this.stopRecording());
        
        // RTC
        this.socket.on('answer', a => this.peer && this.peer.setRemoteDescription(new RTCSessionDescription(a)));
        this.socket.on('remote-candidate', c => this.peer && this.peer.addIceCandidate(new RTCIceCandidate(c)));
        this.socket.on('request-state', async () => {
            if(this.stream) {
                this.socket.emit('camera-state', this.state === 'RECORDING' ? 'recording' : 'idle');
                const devs = await navigator.mediaDevices.enumerateDevices();
                this.socket.emit('camera-devices', devs.filter(d => d.kind === 'videoinput'));
                if (this.track && this.track.getCapabilities) this.socket.emit('camera-capabilities', this.track.getCapabilities());
            }
        });
    }

    log(msg) {
        console.log(`[${this.name}] ${msg}`);
        this.socket.emit('log', { source: this.name, level: 'INFO', message: msg });
    }

    // --- Resolution Probing ---
    async probeMaxResolution(deviceId) {
        const candidates = [
            { w: 3840, h: 2160, label: '4K' },
            { w: 1920, h: 1080, label: '1080p' },
            { w: 1280, h: 720, label: '720p' }
        ];

        for (const res of candidates) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { deviceId: { exact: deviceId }, width: { exact: res.w }, height: { exact: res.h } }
                });
                stream.getTracks().forEach(t => t.stop()); // Close immediately
                console.log(`[${this.name}] Supports ${res.label}`);
                return res.h;
            } catch (e) {
                console.log(`[${this.name}] ${res.label} not supported.`);
            }
        }
        return 720; // Fallback
    }

    async start(updates = {}) {
        Object.assign(this.settings, updates);
        
        // Stop previous
        if (this.stream) this.stream.getTracks().forEach(t => t.stop());
        
        const audioCon = this.settings.proAudio ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 } : true;

        const constraints = {
            audio: audioCon,
            video: {
                deviceId: this.settings.deviceId ? { exact: this.settings.deviceId } : undefined,
                width: { ideal: (this.settings.resolution === 2160) ? 3840 : 1920 },
                height: { ideal: this.settings.resolution },
                frameRate: { ideal: this.settings.fps }
            }
        };
        
        // Basic facing mode if generic
        if (!this.settings.deviceId) constraints.video.facingMode = 'environment';

        try {
            this.stream = await navigator.mediaDevices.getUserMedia(constraints);
            this.videoEl.srcObject = this.stream;
            this.track = this.stream.getVideoTracks()[0];
            
            // Send Capabilities
            const caps = this.track.getCapabilities ? this.track.getCapabilities() : {};
            this.socket.emit('camera-capabilities', caps);
            const devs = await navigator.mediaDevices.enumerateDevices();
            this.socket.emit('camera-devices', devs.filter(d => d.kind === 'videoinput'));

            // Setup Tracking
            let finalStream = this.stream;
            if (this.settings.trackMode !== 'off') {
                this.tracker.setMode(this.settings.trackMode);
                finalStream = this.tracker.start(this.videoEl, this.stream);
            } else {
                this.tracker.stop();
            }

            this.initRTC(finalStream);

        } catch (e) {
            console.error(`[${this.name}] Start failed:`, e);
            if (this.settings.resolution > 720) {
                console.warn("Retrying with lower resolution...");
                this.start({ resolution: 720 });
            }
        }
    }

    initRTC(activeStream = this.stream) {
        if (this.peer) this.peer.close();
        this.peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        activeStream.getTracks().forEach(t => this.peer.addTrack(t, activeStream));
        
        this.peer.onicecandidate = e => { if (e.candidate) this.socket.emit('camera-candidate', e.candidate); };
        this.peer.createOffer().then(o => this.peer.setLocalDescription(o)).then(() => this.socket.emit('offer', this.peer.localDescription));
    }

    startRecording() {
        this.chunks = [];
        const mime = 'video/webm;codecs=vp9'; // Chrome/Desktop usually supports VP9
        const options = { mimeType: mime, videoBitsPerSecond: this.settings.recordingBitrate };
        
        try {
            this.recorder = new MediaRecorder(this.stream, options);
        } catch (e) {
            this.recorder = new MediaRecorder(this.stream); // Fallback
        }

        const ext = 'webm';
        const filename = `host_${this.name}_${Date.now()}.${ext}`;
        this.uploader.start(filename, this.settings.saveToHost);

        this.recorder.ondataavailable = e => {
            if (e.data.size > 0) {
                this.chunks.push(e.data);
                this.uploader.addChunk(e.data);
            }
        };

        this.recorder.onstop = async () => {
            this.state = 'IDLE';
            const saved = await this.uploader.stop();
            if (!saved) {
                // Trigger download in browser
                const blob = new Blob(this.chunks, { type: 'video/webm' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = filename;
                document.body.appendChild(a); a.click(); document.body.removeChild(a);
            }
            this.chunks = [];
        };

        this.recorder.start(1000);
        this.state = 'RECORDING';
        if (this.recEl) this.recEl.classList.add('active');
        if (this.statusEl) this.statusEl.innerText = "REC";
        this.socket.emit('camera-state', 'recording');
    }

    stopRecording() {
        if (this.recorder) this.recorder.stop();
        if (this.recEl) this.recEl.classList.remove('active');
        if (this.statusEl) this.statusEl.innerText = "Ready";
        this.socket.emit('camera-state', 'idle');
    }
}
