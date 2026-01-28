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
        this.saveToHost = false; 
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
        this.track = null;
        this.chunks = [];
        this.state = 'IDLE';

        this.peers = {}; // { remoteId: RTCPeerConnection }

        this.uploader = new UploadManager(socket, (msg) => { if(this.statusEl) this.statusEl.innerText = msg; });
        this.tracker = new SmartTracker();
        this.previewInterval = null;
        this.previewCanvas = document.createElement('canvas');
        this.previewCanvas.width = 160; this.previewCanvas.height = 90;
        this.previewCtx = this.previewCanvas.getContext('2d');

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
                this.refreshPeers();
                this.socket.emit('camera-state', this.state === 'RECORDING' ? 'recording' : 'idle');
            }
        });

        // Command Listeners
        this.socket.on('switch-lens', (d) => this.start({ deviceId: d.payload }));
        
        this.socket.on('set-tether', d => { 
            this.settings.saveToHost = d.payload; 
            this.log(d.payload ? "Tether ON" : "Tether OFF");
        });

        this.socket.on('set-audio-mode', async d => {
            const isPro = (d.payload === 'pro');
            if (this.settings.proAudio === isPro) return;
            this.settings.proAudio = isPro;
            this.log(isPro ? "Audio: High Fidelity" : "Audio: Voice Mode");
            await this.start();
        });

        this.socket.on('set-track-mode', async d => {
            if (this.settings.trackMode === d.payload) return;
            this.settings.trackMode = d.payload;
            this.log(`Tracking: ${d.payload}`);
            await this.start();
        });

        this.socket.on('control-camera', async d => {
            const c = d.payload;
            if (c.resolution || c.frameRate) await this.start({ resolution: c.resolution || this.settings.resolution, fps: c.frameRate || this.settings.fps });
            if (c.bitrate) this.settings.recordingBitrate = c.bitrate;
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
        
        // --- WebRTC Multi-Peer Logic ---
        this.socket.on('request-state', async (d) => {
            // New remote connected. Create a peer for them.
            if(this.stream) {
                this.socket.emit('camera-state', this.state === 'RECORDING' ? 'recording' : 'idle');
                const devs = await navigator.mediaDevices.enumerateDevices();
                this.socket.emit('camera-devices', devs.filter(d => d.kind === 'videoinput'));
                if (this.track && this.track.getCapabilities) this.socket.emit('camera-capabilities', this.track.getCapabilities());
                
                // Initiate connection with this specific remote
                this.createPeer(d.from);
            }
        });

        this.socket.on('answer', (d) => {
            if (this.peers[d.from]) {
                this.peers[d.from].setRemoteDescription(new RTCSessionDescription(d.payload));
            }
        });

        this.socket.on('remote-candidate', (d) => {
            if (this.peers[d.from]) {
                this.peers[d.from].addIceCandidate(new RTCIceCandidate(d.payload));
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
                stream.getTracks().forEach(t => t.stop()); 
                return res.h;
            } catch (e) {}
        }
        return 720; 
    }

    async start(updates = {}) {
        Object.assign(this.settings, updates);
        
        // Stop previous tracks, but keep peers? No, changing stream requires renegotiation.
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
        if (!this.settings.deviceId) constraints.video.facingMode = 'environment';

        try {
            this.stream = await navigator.mediaDevices.getUserMedia(constraints);
            this.videoEl.srcObject = this.stream;
            this.track = this.stream.getVideoTracks()[0];
            
            // Setup Tracking
            let finalStream = this.stream;
            if (this.settings.trackMode !== 'off') {
                this.tracker.setMode(this.settings.trackMode);
                finalStream = this.tracker.start(this.videoEl, this.stream);
            } else {
                this.tracker.stop();
            }

            // Update all connected peers with new stream
            this.refreshPeers(finalStream);

            // Start Preview Broadcast (1 FPS)
            if (this.previewInterval) clearInterval(this.previewInterval);
            this.previewInterval = setInterval(() => this.broadcastPreview(), 1000);

        } catch (e) {
            console.error(`[${this.name}] Start failed:`, e);
            if (this.settings.resolution > 720) {
                console.warn("Retrying with lower resolution...");
                this.start({ resolution: 720 });
            }
        }
    }

    broadcastPreview() {
        if (!this.stream || !this.videoEl) return;
        try {
            this.previewCtx.drawImage(this.videoEl, 0, 0, 160, 90);
            const data = this.previewCanvas.toDataURL('image/jpeg', 0.4);
            this.socket.emit('preview-frame', data);
        } catch(e) {}
    }

    refreshPeers(stream = this.stream) {
        // For existing peers, replace tracks (if supported) or reconnect
        // For now, simpler to close and wait for them to reconnect via 'request-state'?
        // Or just iterate and replaceSender.
        // Let's iterate and renegotiate.
        Object.keys(this.peers).forEach(id => this.createPeer(id, stream));
    }

    createPeer(remoteId, stream = this.stream) {
        if (!stream) return;
        
        if (this.peers[remoteId]) this.peers[remoteId].close();
        
        const peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        this.peers[remoteId] = peer;

        stream.getTracks().forEach(t => peer.addTrack(t, stream));
        
        peer.onicecandidate = e => { 
            if (e.candidate) this.socket.emit('camera-candidate', { target: remoteId, payload: e.candidate }); 
        };

        peer.createOffer().then(o => peer.setLocalDescription(o)).then(() => {
            this.socket.emit('offer', { target: remoteId, payload: peer.localDescription });
        });
    }

    startRecording() {
        this.chunks = [];
        const mime = 'video/webm;codecs=vp9';
        const options = { mimeType: mime, videoBitsPerSecond: this.settings.recordingBitrate };
        
        try {
            this.recorder = new MediaRecorder(this.stream, options);
        } catch (e) {
            this.recorder = new MediaRecorder(this.stream); 
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