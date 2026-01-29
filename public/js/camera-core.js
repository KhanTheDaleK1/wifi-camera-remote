// camera-core.js - Robust Signaling, Multi-Camera Engine & Digital Zoom Fallback

class UploadManager {
    constructor(socket, statusCallback) {
        this.socket = socket;
        this.statusCallback = statusCallback || (() => {});
        this.queue = [];
        this.isUploading = false;
        this.fallbackMode = false;
        this.filename = null;
        this.saveToHost = false; 
    }

    start(filename, saveToHost) {
        this.filename = filename;
        this.saveToHost = saveToHost;
        this.queue = [];
        this.isUploading = false;
        this.fallbackMode = false;
        
        if (this.saveToHost && this.socket.connected) {
            this.socket.emit('start-upload', { filename }, (response) => {
                if (!response || !response.success) {
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
                this.fallbackMode = true;
                this.isUploading = false;
            }
        });
    }

    async stop() {
        if (!this.fallbackMode && this.saveToHost) {
            this.socket.emit('end-upload');
            return true; 
        }
        return false; 
    }
}

class SmartTracker {
    constructor() {
        this.models = { face: null, object: null };
        this.mode = 'off'; 
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d');
        
        // AI Input Optimization
        this.aiCanvas = document.createElement('canvas');
        this.aiCanvas.width = 300;
        this.aiCanvas.height = 300;
        this.aiCtx = this.aiCanvas.getContext('2d');

        this.lastDetect = 0;
        this.interval = 120; 
        this.detecting = false;
        this.isActive = false;
        this.manualZoom = 1.0; // Digital Zoom Fallback
        this.vCam = { x: 0, y: 0, w: 1920, h: 1080 };
        this.target = { x: 0, y: 0, w: 1920, h: 1080 };
    }

    async load() {
        if (window.tf) {
            await tf.setBackend('webgl').catch(() => tf.setBackend('cpu'));
            await tf.ready();
        }
        if (!this.models.face && window.blazeface) this.models.face = await blazeface.load();
        if (!this.models.object && window.cocoSsd) this.models.object = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
    }

    setMode(mode) { this.mode = mode; }
    setDigitalZoom(level) { this.manualZoom = level; }

    start(videoEl, originalStream) {
        this.isActive = true;
        
        // 1. Setup Private Source (Hidden)
        if (!this.internalSource) {
            this.internalSource = document.createElement('video');
            this.internalSource.autoplay = true;
            this.internalSource.muted = true;
            this.internalSource.playsInline = true;
            this.internalSource.style.display = 'none';
        }
        this.internalSource.srcObject = originalStream;
        this.internalSource.play().catch(() => {});

        // 2. Sync Dimensions
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
        if (this.internalSource) {
            this.internalSource.pause();
            this.internalSource.srcObject = null;
        }
    }

    async detect() {
        if (this.detecting || !this.isActive || !this.internalSource) return;
        this.detecting = true;
        let box = null;

        // Resize frame to tiny AI canvas for speed
        if (this.internalSource.readyState >= 2) {
            this.aiCtx.drawImage(this.internalSource, 0, 0, 300, 300);
        }

        if (this.mode !== 'off') {
            try {
                if (this.mode === 'face' && this.models.face) {
                    const faces = await this.models.face.estimateFaces(this.aiCanvas, false);
                    if (faces.length > 0) {
                        const f = faces[0];
                        const scaleX = this.canvas.width / 300;
                        const scaleY = this.canvas.height / 300;
                        box = { 
                            x: f.topLeft[0] * scaleX, 
                            y: f.topLeft[1] * scaleY, 
                            w: (f.bottomRight[0] - f.topLeft[0]) * scaleX, 
                            h: (f.bottomRight[1] - f.topLeft[1]) * scaleY 
                        };
                    }
                } else if (this.models.object) {
                    const preds = await this.models.object.detect(this.aiCanvas);
                    const filtered = preds.filter(p => p.score > 0.4 && (this.mode === 'body' ? p.class === 'person' : p.class !== 'person'));
                    if (filtered.length > 0) {
                        filtered.sort((a,b) => (b.bbox[2]*b.bbox[3]) - (a.bbox[2]*a.bbox[3]));
                        const [x, y, w, h] = filtered[0].bbox;
                        const scaleX = this.canvas.width / 300;
                        const scaleY = this.canvas.height / 300;
                        box = { x: x * scaleX, y: y * scaleY, w: w * scaleX, h: h * scaleY };
                    }
                }
            } catch(e) {}
        }

        if (box) {
            const cx = box.x + box.w/2; const cy = box.y + box.h/2;
            const minH = this.canvas.height * 0.6; // Quality Protection
            let th = Math.max(box.h * 2.2, minH); 
            th = Math.min(th, this.canvas.height);
            let tw = th * (this.canvas.width / this.canvas.height);
            this.target = { x: Math.max(0, Math.min(cx - tw/2, this.canvas.width - tw)), y: Math.max(0, Math.min(cy - th/2, this.canvas.height - th)), w: tw, h: th };
        } else {
            // Apply Manual Digital Zoom
            const th = this.canvas.height / this.manualZoom;
            const tw = this.canvas.width / this.manualZoom;
            this.target = { x: (this.canvas.width - tw) / 2, y: (this.canvas.height - th) / 2, w: tw, h: th };
        }
        this.detecting = false;
    }

    loop() {
        if (!this.isActive) return;
        const now = performance.now();
        if (now - this.lastDetect > this.interval) { 
            this.lastDetect = now; 
            this.detect(); 
        }

        const f = 0.06;
        this.vCam.x += (this.target.x - this.vCam.x) * f;
        this.vCam.y += (this.target.y - this.vCam.y) * f;
        this.vCam.w += (this.target.w - this.vCam.w) * f;
        this.vCam.h += (this.target.h - this.vCam.h) * f;

        try { 
            // Clamp coordinates to prevent "Source bounds" errors which cause black screens
            const sx = Math.max(0, this.vCam.x);
            const sy = Math.max(0, this.vCam.y);
            // Ensure we don't try to draw outside the source video dimensions
            const maxW = this.internalSource.videoWidth || 1920;
            const maxH = this.internalSource.videoHeight || 1080;
            
            const sw = Math.min(this.vCam.w, maxW - sx);
            const sh = Math.min(this.vCam.h, maxH - sy);

            if (this.manualZoom > 1.0) {
                 // Debug only when zoomed in to avoid spam
                 console.log(`[Zoom Debug] In: ${sx.toFixed(1)},${sy.toFixed(1)} ${sw.toFixed(1)}x${sh.toFixed(1)} | Max: ${maxW}x${maxH} | Ready: ${this.internalSource.readyState} | Canvas: ${this.canvas.width}x${this.canvas.height}`);
            }

            // Ensure canvas has valid dimensions
            if (this.canvas.width === 0 || this.canvas.height === 0) {
                this.canvas.width = maxW || 1920;
                this.canvas.height = maxH || 1080;
            }

            // Only draw if the source is actually playing/ready
            if (this.internalSource && this.internalSource.readyState >= 2 && sw > 0 && sh > 0) {
                try {
                    this.ctx.drawImage(this.internalSource, sx, sy, sw, sh, 0, 0, this.canvas.width, this.canvas.height); 
                } catch (drawError) {
                    console.error("[Zoom Error] drawImage failed:", drawError);
                }
            }
        } catch(e) { console.error(e); }
        requestAnimationFrame(() => this.loop());
    }
}

class CameraSession {
    constructor(socket, videoEl, statusEl, recEl, name) {
        this.socket = socket;
        this.videoEl = videoEl;
        this.statusEl = statusEl;
        this.recEl = recEl;
        this.name = name || 'Camera';
        this.stream = null;
        this.track = null;
        this.peers = {};
        this.uploader = new UploadManager(socket, (m) => { if(this.statusEl) this.statusEl.innerText = m; });
        this.tracker = new SmartTracker();
        this.settings = { deviceId: null, facingMode: 'environment', resolution: 1080, fps: 30, saveToHost: false, trackMode: 'off' };
        this.init();
    }

    init() {
        // Handle both immediate connection and future re-connections
        if (this.socket.connected) {
            this.emitJoin();
        }

        this.socket.on('connect', () => {
            console.log(`[${this.name}] Socket Connected`);
            this.emitJoin();
        });

        this.socket.on('request-state', async (d) => {
            if (!this.stream) return; 
            this.socket.emit('camera-state', {
                state: this.state === 'RECORDING' ? 'recording' : 'idle',
                settings: { resolution: this.settings.resolution, fps: this.settings.fps, trackMode: this.settings.trackMode }
            });
            const devs = await navigator.mediaDevices.enumerateDevices();
            this.socket.emit('camera-devices', devs.filter(d => d.kind === 'videoinput'));
            
            let caps = {};
            if (this.track && this.track.getCapabilities) caps = this.track.getCapabilities();
            if (!caps.zoom) caps.zoom = { min: 1, max: 4, step: 0.1 }; // Virtual Zoom
            this.socket.emit('camera-capabilities', caps);
            
            this.createPeer(d.from);
        });

        this.socket.on('answer', (d) => { 
            const p = this.peers[d.from];
            if(p && (p.signalingState === 'have-local-offer' || p.signalingState === 'have-remote-pranswer')) {
                p.setRemoteDescription(new RTCSessionDescription(d.payload)).catch(() => {}); 
            }
        });

        this.socket.on('remote-candidate', (d) => { 
            const p = this.peers[d.from];
            if(p && p.remoteDescription) {
                p.addIceCandidate(new RTCIceCandidate(d.payload)).catch(() => {}); 
            }
        });

        // Commands
        this.socket.on('start-recording', () => this.startRec());
        this.socket.on('stop-recording', () => this.stopRec());
        this.socket.on('switch-camera', () => {
            const next = this.settings.facingMode === 'user' ? 'environment' : 'user';
            this.start({ facingMode: next, deviceId: null });
        });
        this.socket.on('switch-lens', (d) => this.start({ deviceId: d.payload }));
        this.socket.on('set-tether', d => { this.settings.saveToHost = d.payload; });
        this.socket.on('set-track-mode', async d => {
            if (this.settings.trackMode === d.payload) return;
            this.settings.trackMode = d.payload;
            await this.start();
        });
        this.socket.on('control-camera', async (d) => {
            const c = d.payload;
            if (c.resolution || c.frameRate) await this.start({ resolution: c.resolution || this.settings.resolution, fps: c.frameRate || this.settings.fps });
            if (this.track) {
                const adv = {};
                let hardwareZoomUsed = false;
                if (c.zoom) {
                    const caps = this.track.getCapabilities ? this.track.getCapabilities() : {};
                    if (caps.zoom) { adv.zoom = c.zoom; hardwareZoomUsed = true; } 
                    else { this.tracker.setDigitalZoom(c.zoom); if (!this.tracker.isActive) await this.start(); }
                }
                if (c.torch !== undefined) adv.torch = c.torch;
                if (c.focusDistance !== undefined) { adv.focusMode = 'manual'; adv.focusDistance = c.focusDistance; }
                
                if (Object.keys(adv).length > 0) {
                    this.track.applyConstraints({ advanced: [adv] }).catch(() => {
                        if (c.zoom && hardwareZoomUsed) this.tracker.setDigitalZoom(c.zoom);
                    });
                }
            }
        });
    }

    emitJoin() {
        this.socket.emit('join-camera', { name: this.name });
        this.tracker.load();
    }

    async probeMaxResolution(id) {
        const c = [{ w: 3840, h: 2160 }, { w: 1920, h: 1080 }, { w: 1280, h: 720 }];
        for (const r of c) {
            try {
                const s = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: id }, width: { exact: r.w }, height: { exact: r.h } } });
                s.getTracks().forEach(t => t.stop()); return r.h;
            } catch(e) {}
        }
        return 720;
    }

    async start(up = {}) {
        Object.assign(this.settings, up);
        if (this.stream) this.stream.getTracks().forEach(t => t.stop());
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: { 
                    deviceId: this.settings.deviceId ? { exact: this.settings.deviceId } : undefined, 
                    facingMode: this.settings.deviceId ? undefined : this.settings.facingMode, 
                    width: { ideal: 1920 }, 
                    height: { ideal: this.settings.resolution }, 
                    frameRate: { ideal: this.settings.fps } 
                },
                audio: true
            });
            this.videoEl.srcObject = this.stream;
            // FORCE PLAY: Ensure the video element is actually processing frames
            this.videoEl.play().catch(e => console.error("Local play error:", e));
            
            this.track = this.stream.getVideoTracks()[0];
            let out = this.stream;
            if (this.settings.trackMode !== 'off' || this.tracker.manualZoom > 1.0) { 
                this.tracker.setMode(this.settings.trackMode); 
                out = this.tracker.start(this.videoEl, this.stream); 
                // Display the zoomed/processed stream on the local preview
                this.videoEl.srcObject = out;
            } else { 
                this.tracker.stop(); 
                this.videoEl.srcObject = this.stream; // Show raw feed if zoom is 1.0
            }
            this.refreshPeers(out);
        } catch(e) { console.error(e); }
    }

    refreshPeers(stream = this.stream) {
        Object.keys(this.peers).forEach(id => {
            const p = this.peers[id];
            if (p && p.connectionState === 'connected' && p.signalingState === 'stable') {
                const videoSender = p.getSenders().find(s => s.track && s.track.kind === 'video');
                if (videoSender) { videoSender.replaceTrack(stream.getVideoTracks()[0]); return; }
            }
            this.createPeer(id, stream);
        });
    }

    createPeer(id, stream = this.stream) {
        if (!stream) return;
        if (this.peers[id]) { try { this.peers[id].close(); } catch(e) {} }
        const p = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        this.peers[id] = p;
        stream.getTracks().forEach(t => p.addTrack(t, stream));
        p.onicecandidate = e => { if(e.candidate) this.socket.emit('camera-candidate', { target: id, payload: e.candidate }); };
        p.onconnectionstatechange = () => { if (p.connectionState === 'failed' || p.connectionState === 'closed') delete this.peers[id]; };
        p.createOffer().then(o => p.setLocalDescription(o)).then(() => { this.socket.emit('offer', { target: id, payload: p.localDescription }); });
    }

    startRec() {
        this.chunks = [];
        
        // 1. Select Best Quality Mime Type
        let mimeType = 'video/webm';
        let ext = 'webm';
        const types = [
            { mime: 'video/mp4;codecs=avc1', ext: 'mp4' }, // H.264 (Great for iOS/Compatibility)
            { mime: 'video/mp4', ext: 'mp4' },
            { mime: 'video/webm;codecs=vp9', ext: 'webm' }, // VP9 (High Quality WebM)
            { mime: 'video/webm;codecs=vp8', ext: 'webm' },
            { mime: 'video/webm', ext: 'webm' }
        ];
        
        for (const t of types) {
            if (MediaRecorder.isTypeSupported(t.mime)) {
                mimeType = t.mime;
                ext = t.ext;
                console.log(`[Recorder] Selected Format: ${mimeType}`);
                break;
            }
        }

        // 2. High Bitrate Options (25 Mbps)
        const options = {
            mimeType: mimeType,
            videoBitsPerSecond: 25000000 // 25 Mbps
        };

        try {
            this.recorder = new MediaRecorder(this.stream, options);
        } catch (e) {
            console.error('[Recorder] Failed to create recorder with options, falling back to default', e);
            this.recorder = new MediaRecorder(this.stream); // Fallback
            ext = 'webm'; // Default assumption
        }

        this.uploader.start(`rec_${Date.now()}.${ext}`, this.settings.saveToHost);
        
        this.recorder.ondataavailable = e => { if(e.data.size > 0) { this.chunks.push(e.data); this.uploader.addChunk(e.data); } };
        this.recorder.onstop = async () => {
            await this.uploader.stop(); // Always try to finish upload logic
            
            // ALWAYS provide a local download option as backup/confirmation
            const b = new Blob(this.chunks, { type: mimeType });
            const a = document.createElement('a'); 
            a.href = URL.createObjectURL(b); 
            a.download = `vid_${Date.now()}.${ext}`; 
            a.click();
        };
        this.recorder.start(1000);
        this.state = 'RECORDING';
        if (this.recEl) this.recEl.classList.add('active');
        this.socket.emit('camera-state', 'recording');
    }

    stopRec() {
        if (this.recorder) this.recorder.stop();
        this.state = 'IDLE';
        if (this.recEl) this.recEl.classList.remove('active');
        this.socket.emit('camera-state', 'idle');
    }
}