// camera-core.js - Cinematic Tracking & Robust Signaling

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

class CinematicTracker {
    constructor() {
        this.models = { face: null, object: null };
        this.mode = 'off';
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d', { alpha: false });
        this.aiSize = 300;
        this.aiCanvas = document.createElement('canvas');
        this.aiCanvas.width = this.aiSize;
        this.aiCanvas.height = this.aiSize;
        this.aiCtx = this.aiCanvas.getContext('2d', { alpha: false });

        this.isActive = false;
        this.detecting = false;
        this.lastDetectTime = 0;
        this.detectInterval = 60; 
        
        this.sensor = { w: 1, h: 1 };
        this.vCam = { x: 0, y: 0, w: 1, h: 1 };
        
        this.lockPoint = null;
        this.trackedBox = null;
        this.lostFrameCount = 0;
        this.manualZoom = 1.0;
    }

    async load() {
        try {
            if (window.tf) {
                await tf.setBackend('webgl').catch(() => tf.setBackend('cpu'));
                await tf.ready();
            }
            if (window.blazeface && !this.models.face) {
                this.models.face = await blazeface.load();
                console.log("[AI] Face Ready");
            }
            if (window.cocoSsd && !this.models.object) {
                this.models.object = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
                console.log("[AI] Object Ready");
            }
        } catch (e) { console.error("[AI] Load Error:", e); }
    }

    setMode(mode) { 
        this.mode = mode; 
        this.lockPoint = null;
        this.trackedBox = null;
        this.lostFrameCount = 0;
    }

    setDigitalZoom(z) { this.manualZoom = z; }

    setSelection(nx, ny) {
        // Map UI tap (normalized) to absolute sensor coordinates
        const absX = this.vCam.x + (nx * this.vCam.w);
        const absY = this.vCam.y + (ny * this.vCam.h);
        this.lockPoint = { x: absX, y: absY };
        this.lostFrameCount = 0;
        console.log(`[AI] Lock Set: ${Math.round(absX)}x${Math.round(absY)}`);
    }

    start(videoEl, stream) {
        this.isActive = true;
        if (!this.internalSource) {
            this.internalSource = document.createElement('video');
            this.internalSource.autoplay = true;
            this.internalSource.muted = true;
            this.internalSource.playsInline = true;
            this.internalSource.style.cssText = "position:fixed; top:0; left:0; width:4px; height:4px; opacity:0.1; z-index:-1;";
            document.body.appendChild(this.internalSource);
        }
        this.internalSource.srcObject = stream;
        
        return new Promise((resolve) => {
            const onReady = () => {
                const vw = this.internalSource.videoWidth || 1920;
                const vh = this.internalSource.videoHeight || 1080;
                this.sensor = { w: vw, h: vh };
                this.canvas.width = vw;
                this.canvas.height = vh;
                this.vCam = { x: 0, y: 0, w: vw, h: vh };
                
                this.loop();
                console.log(`[AI] Pipeline Started: ${vw}x${vh}`);
                resolve(this.canvas.captureStream(30));
            };

            if (this.internalSource.readyState >= 1) {
                onReady();
            } else {
                this.internalSource.onloadedmetadata = onReady;
                // Timeout fallback to prevent black screen hang
                setTimeout(() => {
                    if (this.canvas.width === 0) {
                        console.warn("[AI] Metadata timeout - forcing start");
                        // Force defaults
                        this.sensor = { w: 1920, h: 1080 };
                        this.canvas.width = 1920;
                        this.canvas.height = 1080;
                        this.vCam = { x: 0, y: 0, w: 1920, h: 1080 };
                        onReady();
                    }
                }, 2000);
            }
            this.internalSource.play().catch(e => console.warn("Internal Play:", e));
        });
    }

    stop() { this.isActive = false; }

    async detect() {
        if (this.detecting || this.mode === 'off') return;
        
        // Ensure models are trying to load if missing
        if (!this.models.face && !this.models.object) {
            console.warn("[AI] No models loaded - retrying load");
            this.load();
            return;
        }

        this.detecting = true;
        const vw = this.sensor.w;
        const vh = this.sensor.h;

        const scale = Math.min(this.aiSize / vw, this.aiSize / vh);
        const tx = (this.aiSize - vw * scale) / 2;
        const ty = (this.aiSize - vh * scale) / 2;

        this.aiCtx.fillStyle = 'black';
        this.aiCtx.fillRect(0, 0, this.aiSize, this.aiSize);
        this.aiCtx.drawImage(this.internalSource, tx, ty, vw * scale, vh * scale);

        let candidates = [];
        try {
            if (this.mode === 'face' && this.models.face) {
                const faces = await this.models.face.estimateFaces(this.aiCanvas, false);
                candidates = faces.map(f => ({
                    x: (f.topLeft[0] - tx) / scale,
                    y: (f.topLeft[1] - ty) / scale,
                    w: (f.bottomRight[0] - f.topLeft[0]) / scale,
                    h: (f.bottomRight[1] - f.topLeft[1]) / scale,
                    prob: f.probability[0],
                    label: 'Face'
                }));
            } else if (this.models.object && this.models.object) {
                const preds = await this.models.object.detect(this.aiCanvas);
                // Lower threshold to 0.2 for better sensitivity
                candidates = preds.filter(p => p.score > 0.2).map(p => ({
                    x: (p.bbox[0] - tx) / scale,
                    y: (p.bbox[1] - ty) / scale,
                    w: p.bbox[2] / scale,
                    h: p.bbox[3] / scale,
                    prob: p.score,
                    label: p.class
                }));
            }
        } catch (e) { console.error("[AI] Detect Error:", e); }

        if (candidates.length > 0) {
            let best = null;
            if (this.lockPoint) {
                let minDist = Infinity;
                candidates.forEach(c => {
                    const cx = c.x + c.w/2;
                    const cy = c.y + c.h/2;
                    const d = Math.hypot(cx - this.lockPoint.x, cy - this.lockPoint.y);
                    if (d < minDist) { minDist = d; best = c; }
                });
                if (best && minDist < this.sensor.w * 0.4) { // Wider search radius
                    this.trackedBox = best;
                    this.lockPoint = { x: best.x + best.w/2, y: best.y + best.h/2 };
                    this.lostFrameCount = 0;
                } else {
                    this.lostFrameCount++;
                }
            } else {
                this.trackedBox = candidates.sort((a,b) => (b.w*b.h) - (a.w*a.h))[0];
                this.lostFrameCount = 0;
            }
        } else {
            this.lostFrameCount++;
        }

        if (this.lostFrameCount > 30) { // 1.5 seconds
            this.trackedBox = null;
            this.lockPoint = null;
        }

        this.detecting = false;
        this.lastDetectTime = performance.now();
    }

    loop() {
        if (!this.isActive) return;
        
        // Log once to confirm activity
        if (!this.hasRendered) {
            console.log("[Cinematic] Render Loop Active");
            this.hasRendered = true;
        }

        if (performance.now() - this.lastDetectTime > this.detectInterval) this.detect();

        let tx = 0, ty = 0, tw = this.sensor.w, th = this.sensor.h;

        if (this.trackedBox) {
            const cx = this.trackedBox.x + this.trackedBox.w / 2;
            const cy = this.trackedBox.y + this.trackedBox.h / 2;
            th = Math.max(this.sensor.h / 3, Math.min(this.sensor.h, this.trackedBox.h * 3));
            tw = th * (this.sensor.w / this.sensor.h);
            tx = cx - tw / 2;
            ty = cy - th / 2;
        } else if (this.manualZoom > 1.0) {
            tw = this.sensor.w / this.manualZoom;
            th = this.sensor.h / this.manualZoom;
            tx = (this.sensor.w - tw) / 2;
            ty = (this.sensor.h - th) / 2;
        }

        tx = Math.max(0, Math.min(tx, this.sensor.w - tw));
        ty = Math.max(0, Math.min(ty, this.sensor.h - th));

        const ease = 0.1;
        this.vCam.x += (tx - this.vCam.x) * ease;
        this.vCam.y += (ty - this.vCam.y) * ease;
        this.vCam.w += (tw - this.vCam.w) * ease;
        this.vCam.h += (th - this.vCam.h) * ease;

        if (this.internalSource.readyState >= 2) {
            this.ctx.drawImage(this.internalSource, this.vCam.x, this.vCam.y, this.vCam.w, this.vCam.h, 0, 0, this.canvas.width, this.canvas.height);
            
            // UI OVERLAY
            if (this.mode !== 'off') {
                const sX = (x) => (x - this.vCam.x) * (this.canvas.width / this.vCam.w);
                const sY = (y) => (y - this.vCam.y) * (this.canvas.height / this.vCam.h);
                const sW = (w) => w * (this.canvas.width / this.vCam.w);

                // Status Indicator
                this.ctx.fillStyle = 'rgba(0,0,0,0.5)';
                this.ctx.fillRect(10, 10, 200, 40);
                this.ctx.fillStyle = '#00ff00';
                this.ctx.font = '20px monospace';
                this.ctx.fillText(`AI: ${this.mode.toUpperCase()}`, 20, 35);

                if (this.trackedBox) {
                    const b = this.trackedBox;
                    this.ctx.strokeStyle = '#00ff00';
                    this.ctx.lineWidth = 4;
                    this.ctx.strokeRect(sX(b.x), sY(b.y), sW(b.w), sW(b.h));
                    this.ctx.fillText(`${b.label} ${Math.round(b.prob*100)}%`, sX(b.x), sY(b.y) - 10);
                } else {
                    this.ctx.fillStyle = '#ff9f0a';
                    this.ctx.fillText('SEARCHING...', 20, 70);
                }

                if (this.lockPoint) {
                    this.ctx.beginPath();
                    this.ctx.arc(sX(this.lockPoint.x), sY(this.lockPoint.y), 10, 0, Math.PI*2);
                    this.ctx.fillStyle = 'red';
                    this.ctx.fill();
                }
            }
        }
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
        this.tracker = new CinematicTracker();
        this.settings = { deviceId: null, facingMode: 'environment', resolution: 1080, fps: 30, trackMode: 'off' };
        this.peers = {};
        this.isStarting = false;
        this.uploader = new UploadManager(socket, (m) => { if(this.statusEl) this.statusEl.innerText = m; });
        this.init();
    }

    init() {
        this.socket.on('connect', () => this.emitJoin());
        this.socket.on('request-state', async (d) => {
            if (!this.stream) return;
            const devs = await navigator.mediaDevices.enumerateDevices();
            this.socket.emit('camera-devices', devs.filter(d => d.kind === 'videoinput'));
            this.socket.emit('camera-state', { state: this.state === 'RECORDING' ? 'recording' : 'idle', settings: this.settings });
            this.createPeer(d.from);
        });
        this.socket.on('set-track-mode', d => { this.settings.trackMode = d.payload; this.tracker.setMode(d.payload); });
        this.socket.on('set-track-point', d => this.tracker.setSelection(d.payload.x, d.payload.y));
        this.socket.on('answer', d => { if(this.peers[d.from]) this.peers[d.from].setRemoteDescription(new RTCSessionDescription(d.payload)).catch(e=>console.error(e)); });
        this.socket.on('remote-candidate', d => { if(this.peers[d.from]) this.peers[d.from].addIceCandidate(new RTCIceCandidate(d.payload)).catch(e=>console.error(e)); });
        this.socket.on('start-recording', () => this.startRec());
        this.socket.on('stop-recording', () => this.stopRec());
        this.socket.on('switch-camera', () => this.start({ facingMode: this.settings.facingMode === 'user' ? 'environment' : 'user' }));
        this.socket.on('switch-lens', d => this.start({ deviceId: d.payload }));
        this.socket.on('control-camera', async d => {
            const c = d.payload;
            if (c.resolution || c.frameRate) await this.start({ resolution: c.resolution || this.settings.resolution, fps: c.frameRate || this.settings.fps });
            if (c.zoom) this.tracker.setDigitalZoom(c.zoom);
        });
        if (this.socket.connected) this.emitJoin();
    }

    emitJoin() { this.socket.emit('join-camera', { name: this.name }); this.tracker.load(); }

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
        if (this.isStarting) {
            console.warn("[Camera] Start ignored - already initializing");
            return;
        }
        this.isStarting = true;

        Object.assign(this.settings, up);
        if (this.stream) this.stream.getTracks().forEach(t => t.stop());
        
        const constraints = {
            video: { 
                deviceId: this.settings.deviceId ? { exact: this.settings.deviceId } : undefined,
                height: { ideal: this.settings.resolution, min: 720 },
                aspectRatio: { ideal: 1.7777777778 }
            },
            audio: true
        };

        try {
            console.log(`[Camera] Requesting: ${JSON.stringify(constraints.video)}`);
            this.stream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (e) { 
            console.warn(`[Camera] High-res failed: ${e.message}. Fallback to basic.`);
            try {
                this.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            } catch (err) {
                console.error("[Camera] Fatal Error:", err);
                return;
            }
        } finally {
            // If we failed to get a stream, clear lock
            if (!this.stream) this.isStarting = false;
        }

        try {
            const settings = this.stream.getVideoTracks()[0].getSettings();
            console.log(`[Camera] Started: ${settings.width}x${settings.height}`);
            
            const out = await this.tracker.start(this.videoEl, this.stream);
            this.videoEl.srcObject = out;
            this.refreshPeers(out);
        } catch (e) {
            console.error("[Camera] Tracker Error:", e);
        } finally {
            this.isStarting = false;
        }
    }

    refreshPeers(stream) {
        Object.keys(this.peers).forEach(id => this.createPeer(id, stream));
    }

    createPeer(id, stream = this.stream) {
        if (!stream) return;
        if (this.peers[id]) this.peers[id].close();
        const p = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        this.peers[id] = p;
        stream.getTracks().forEach(t => p.addTrack(t, stream));
        p.onicecandidate = e => { if(e.candidate) this.socket.emit('camera-candidate', { target: id, payload: e.candidate }); };
        p.createOffer().then(o => p.setLocalDescription(o)).then(() => this.socket.emit('offer', { target: id, payload: p.localDescription }));
    }

    startRec() {
        this.chunks = [];
        this.recorder = new MediaRecorder(this.stream, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 10000000 });
        this.uploader.start(`rec_${Date.now()}.webm`, false);
        this.recorder.ondataavailable = e => { if(e.data.size > 0) { this.chunks.push(e.data); this.uploader.addChunk(e.data); } };
        this.recorder.start(1000);
        this.state = 'RECORDING';
    }

    stopRec() { if(this.recorder) this.recorder.stop(); this.state = 'IDLE'; }
}