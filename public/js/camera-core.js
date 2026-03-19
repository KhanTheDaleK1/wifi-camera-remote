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
        this.rawStream = null;
        this.outputStream = null;
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
        console.log(`[AI] Mode: ${mode}`);
    }

    setDigitalZoom(z) { this.manualZoom = z; }

    setSelection(nx, ny) {
        const absX = this.vCam.x + (nx * this.vCam.w);
        const absY = this.vCam.y + (ny * this.vCam.h);
        this.lockPoint = { x: absX, y: absY };
        this.lostFrameCount = 0;
        console.log(`[AI] Lock Set: ${Math.round(absX)}x${Math.round(absY)}`);
    }

    async start(stream) {
        this.isActive = true;
        this.rawStream = stream;

        if (!this.internalSource) {
            this.internalSource = document.createElement('video');
            this.internalSource.autoplay = true;
            this.internalSource.muted = true;
            this.internalSource.playsInline = true;
            this.internalSource.style.cssText = "position:fixed; top:0; left:0; width:4px; height:4px; opacity:0.01; pointer-events:none;";
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
                this.outputStream = this.canvas.captureStream(30);
                resolve(this.outputStream);
            };

            if (this.internalSource.readyState >= 2) {
                onReady();
            } else {
                this.internalSource.onloadedmetadata = onReady;
            }
            this.internalSource.play().catch(e => console.warn("[AI] Play failed:", e));
        });
    }

    stop() { 
        this.isActive = false; 
        if (this.internalSource) {
            this.internalSource.srcObject = null;
        }
    }

    async detect() {
        if (this.detecting || this.mode === 'off') return;
        
        if (!this.models.face && !this.models.object) {
            this.load();
            return;
        }

        this.detecting = true;
        const vw = this.sensor.w;
        const vh = this.sensor.h;

        const scale = Math.min(this.aiSize / vw, this.aiSize / vh);
        const tx = (this.aiSize - vw * scale) / 2;
        const ty = (this.aiSize - vh * scale) / 2;

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
            } else if (this.mode === 'object' && this.models.object) {
                const preds = await this.models.object.detect(this.aiCanvas);
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
                if (best && minDist < this.sensor.w * 0.4) {
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

        if (this.lostFrameCount > 30) {
            this.trackedBox = null;
            this.lockPoint = null;
        }

        this.detecting = false;
        this.lastDetectTime = performance.now();
    }

    loop() {
        if (!this.isActive) return;

        // Bypass drawing if mode is off and no digital zoom
        if (this.mode === 'off' && this.manualZoom <= 1.0) {
            // We still want to clear or show something if needed, 
            // but for maximum performance we should minimize work here.
            // Note: If we are in bypass, the MediaPipeline handles sending the raw stream.
            requestAnimationFrame(() => this.loop());
            return;
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

        const ease = 0.15; // Slightly faster easing
        this.vCam.x += (tx - this.vCam.x) * ease;
        this.vCam.y += (ty - this.vCam.y) * ease;
        this.vCam.w += (tw - this.vCam.w) * ease;
        this.vCam.h += (th - this.vCam.h) * ease;

        if (this.internalSource.readyState >= 2) {
            this.ctx.drawImage(this.internalSource, this.vCam.x, this.vCam.y, this.vCam.w, this.vCam.h, 0, 0, this.canvas.width, this.canvas.height);
            
            if (this.mode !== 'off') {
                const sX = (x) => (x - this.vCam.x) * (this.canvas.width / this.vCam.w);
                const sY = (y) => (y - this.vCam.y) * (this.canvas.height / this.vCam.h);
                const sW = (w) => w * (this.canvas.width / this.vCam.w);

                this.ctx.fillStyle = 'rgba(0,0,0,0.5)';
                this.ctx.fillRect(10, 10, 180, 35);
                this.ctx.fillStyle = '#00ff00';
                this.ctx.font = 'bold 18px sans-serif';
                this.ctx.fillText(`AI TRACK: ${this.mode.toUpperCase()}`, 20, 34);

                if (this.trackedBox) {
                    const b = this.trackedBox;
                    this.ctx.strokeStyle = '#00ff00';
                    this.ctx.lineWidth = 3;
                    this.ctx.strokeRect(sX(b.x), sY(b.y), sW(b.w), sW(b.h));
                }
            }
        }
        requestAnimationFrame(() => this.loop());
    }
}

class MediaPipeline {
    constructor(tracker) {
        this.tracker = tracker;
        this.rawStream = null;
        this.processedStream = null;
        this.activeStream = null;
        this.settings = { deviceId: null, facingMode: 'environment', resolution: 1080, fps: 30, trackMode: 'off', zoom: 1.0 };
        this.onStreamChanged = null;
    }

    async start(constraintsOverride = {}) {
        Object.assign(this.settings, constraintsOverride);
        
        if (this.rawStream) {
            this.rawStream.getTracks().forEach(t => t.stop());
        }

        const constraints = {
            video: {
                deviceId: this.settings.deviceId ? { exact: this.settings.deviceId } : undefined,
                facingMode: this.settings.deviceId ? undefined : this.settings.facingMode,
                height: { ideal: this.settings.resolution },
                frameRate: { ideal: this.settings.fps },
                // Optimization for low latency
                latency: 0 
            },
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            }
        };

        try {
            console.log("[Pipeline] Requesting stream...", constraints.video);
            this.rawStream = await navigator.mediaDevices.getUserMedia(constraints);
            
            // Initialize tracker with raw stream
            this.processedStream = await this.tracker.start(this.rawStream);
            
            this.updateActiveStream();
            return this.activeStream;
        } catch (e) {
            console.error("[Pipeline] Start failed:", e);
            throw e;
        }
    }

    setTrackMode(mode) {
        this.settings.trackMode = mode;
        this.tracker.setMode(mode);
        this.updateActiveStream();
    }

    setZoom(zoom) {
        this.settings.zoom = zoom;
        this.tracker.setDigitalZoom(zoom);
        this.updateActiveStream();
    }

    updateActiveStream() {
        const needsProcessing = this.settings.trackMode !== 'off' || this.settings.zoom > 1.0;
        const newActive = needsProcessing ? this.processedStream : this.rawStream;
        
        if (this.activeStream !== newActive) {
            console.log(`[Pipeline] Switching to ${needsProcessing ? 'Processed' : 'Direct'} Stream`);
            this.activeStream = newActive;
            if (this.onStreamChanged) this.onStreamChanged(this.activeStream);
        }
    }

    getStream() {
        return this.activeStream || this.rawStream;
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
        this.pipeline = new MediaPipeline(this.tracker);
        this.peers = {};
        this.isStarting = false;
        this.uploader = new UploadManager(socket, (m) => { if(this.statusEl) this.statusEl.innerText = m; });
        
        this.pipeline.onStreamChanged = (stream) => {
            this.videoEl.srcObject = stream;
            this.refreshPeers(stream);
        };
        
        this.init();
    }

    init() {
        this.socket.on('connect', () => this.emitJoin());
        this.socket.on('request-state', async (d) => {
            const stream = this.pipeline.getStream();
            if (!stream) return;
            const devs = await navigator.mediaDevices.enumerateDevices();
            this.socket.emit('camera-devices', devs.filter(d => d.kind === 'videoinput'));
            this.socket.emit('camera-state', { state: this.state === 'RECORDING' ? 'recording' : 'idle', settings: this.pipeline.settings });
            this.createPeer(d.from);
        });
        
        this.socket.on('set-track-mode', d => this.pipeline.setTrackMode(d.payload));
        this.socket.on('set-track-point', d => this.tracker.setSelection(d.payload.x, d.payload.y));
        this.socket.on('answer', d => { if(this.peers[d.from]) this.peers[d.from].setRemoteDescription(new RTCSessionDescription(d.payload)).catch(e=>console.error(e)); });
        this.socket.on('remote-candidate', d => { if(this.peers[d.from]) this.peers[d.from].addIceCandidate(new RTCIceCandidate(d.payload)).catch(e=>console.error(e)); });
        this.socket.on('start-recording', () => this.startRec());
        this.socket.on('stop-recording', () => this.stopRec());
        this.socket.on('switch-camera', () => this.pipeline.start({ facingMode: this.pipeline.settings.facingMode === 'user' ? 'environment' : 'user' }));
        this.socket.on('switch-lens', d => this.pipeline.start({ deviceId: d.payload }));
        this.socket.on('control-camera', async d => {
            const c = d.payload;
            if (c.resolution || c.frameRate) await this.pipeline.start({ resolution: c.resolution || this.pipeline.settings.resolution, fps: c.frameRate || this.pipeline.settings.fps });
            if (c.zoom) this.pipeline.setZoom(c.zoom);
        });
        if (this.socket.connected) this.emitJoin();
    }

    emitJoin() { this.socket.emit('join-camera', { name: this.name }); this.tracker.load(); }

    async start(up = {}) {
        if (this.isStarting) return;
        this.isStarting = true;
        try {
            const stream = await this.pipeline.start(up);
            this.videoEl.srcObject = stream;
        } finally {
            this.isStarting = false;
        }
    }

    refreshPeers(stream) {
        Object.keys(this.peers).forEach(id => {
            const p = this.peers[id];
            // Instead of full renegotiation, we can just replace the tracks if supported,
            // but for simplicity and reliability here, we recreate the peer connection.
            this.createPeer(id, stream);
        });
    }

    createPeer(id, stream = this.pipeline.getStream()) {
        if (!stream) return;
        if (this.peers[id]) this.peers[id].close();
        
        const config = {
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
            bundlePolicy: 'max-bundle',
            rtcpMuxPolicy: 'require',
            sdpSemantics: 'unified-plan'
        };
        
        const p = new RTCPeerConnection(config);
        this.peers[id] = p;
        
        stream.getTracks().forEach(t => p.addTrack(t, stream));
        
        p.onicecandidate = e => { if(e.candidate) this.socket.emit('camera-candidate', { target: id, payload: e.candidate }); };
        p.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true
        }).then(o => p.setLocalDescription(o)).then(() => this.socket.emit('offer', { target: id, payload: p.localDescription }));
    }

    startRec() {
        this.chunks = [];
        const stream = this.pipeline.getStream();
        this.recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 8000000 });
        this.uploader.start(`rec_${Date.now()}.webm`, false);
        this.recorder.ondataavailable = e => { if(e.data.size > 0) { this.chunks.push(e.data); this.uploader.addChunk(e.data); } };
        this.recorder.start(1000);
        this.state = 'RECORDING';
    }

    stopRec() { if(this.recorder) this.recorder.stop(); this.state = 'IDLE'; }
}