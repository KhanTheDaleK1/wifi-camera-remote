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
        this.ctx.imageSmoothingEnabled = true;
        this.ctx.imageSmoothingQuality = 'high';
        
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
        try {
            if (window.tf) {
                await tf.setBackend('webgl').catch(() => tf.setBackend('cpu'));
                await tf.ready();
            }
            if (!this.models.face && window.blazeface) {
                console.log("[AI] Loading Face Model...");
                try {
                    this.models.face = await blazeface.load();
                    console.log("[AI] Face Model Loaded");
                } catch (e) { console.error("[AI] Face Model Failed:", e); }
            }
            if (!this.models.object && window.cocoSsd) {
                console.log("[AI] Loading Object Model...");
                try {
                    this.models.object = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
                    console.log("[AI] Object Model Loaded");
                } catch (e) { console.error("[AI] Object Model Failed:", e); }
            }
        } catch (e) {
            console.error("[AI] Model Init Error:", e);
        }
    }

    setMode(mode) { this.mode = mode; }
    setDigitalZoom(level) { this.manualZoom = level; }

    start(videoEl, originalStream) {
        // Prevent multiple loops if already active
        if (this.isActive) {
            // Just update source if it changed
            if (this.internalSource && this.internalSource.srcObject !== originalStream) {
                this.internalSource.srcObject = originalStream;
                this.internalSource.play().catch(() => {});
            }
            return this.canvas.captureStream(30);
        }

        this.isActive = true;
        
        // 1. Setup Private Source (Hidden but in DOM for iOS)
        if (!this.internalSource) {
            this.internalSource = document.createElement('video');
            this.internalSource.autoplay = true;
            this.internalSource.muted = true;
            this.internalSource.playsInline = true;
            // iOS requires element to be in DOM and not "display:none" for video processing
            this.internalSource.style.position = 'fixed';
            this.internalSource.style.top = '0';
            this.internalSource.style.left = '0';
            this.internalSource.style.width = '1px';
            this.internalSource.style.height = '1px';
            this.internalSource.style.opacity = '0.01';
            this.internalSource.style.pointerEvents = 'none';
            this.internalSource.style.zIndex = '-1';
            document.body.appendChild(this.internalSource);
        }
        this.internalSource.srcObject = originalStream;
        this.internalSource.play().catch(e => console.error("[AI] Internal Play Error:", e));

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

        // --- Center-Crop logic for AI Input (300x300) ---
        // Prevents squashing/stretching which breaks AI models
        if (this.internalSource.readyState >= 2) {
            const vw = this.internalSource.videoWidth;
            const vh = this.internalSource.videoHeight;
            const size = Math.min(vw, vh);
            const sx = (vw - size) / 2;
            const sy = (vh - size) / 2;
            
            // Draw a square center-cropped portion of the video into the 300x300 AI canvas
            this.aiCtx.drawImage(this.internalSource, sx, sy, size, size, 0, 0, 300, 300);
            
            // Map detected coordinates back to original stream coordinates
            this.aiCoordMap = { offset: { x: sx, y: sy }, scale: size / 300 };
        } else {
            // Debug stream issues
            // console.warn("[AI] Source Not Ready", this.internalSource.readyState);
            this.detecting = false; 
            return;
        }

        if (this.mode !== 'off') {
            try {
                if (this.mode === 'face' && this.models.face) {
                    const faces = await this.models.face.estimateFaces(this.aiCanvas, false);
                    if (faces.length > 0) {
                        console.log(`[AI] Found Face (Conf: ${faces[0].probability[0].toFixed(2)})`);
                        const f = faces[0];
                        const m = this.aiCoordMap;
                        // Calculate box in original pixel space
                        box = { 
                            x: m.offset.x + (f.topLeft[0] * m.scale), 
                            y: m.offset.y + (f.topLeft[1] * m.scale), 
                            w: (f.bottomRight[0] - f.topLeft[0]) * m.scale, 
                            h: (f.bottomRight[1] - f.topLeft[1]) * m.scale 
                        };
                    }
                } else if (this.models.object) {
                    const preds = await this.models.object.detect(this.aiCanvas);
                    const filtered = preds.filter(p => p.score > 0.4 && (this.mode === 'body' ? p.class === 'person' : true));
                    
                    if (filtered.length > 0) {
                        filtered.sort((a,b) => (b.bbox[2]*b.bbox[3]) - (a.bbox[2]*a.bbox[3]));
                        console.log(`[AI] Found ${filtered[0].class} (Conf: ${filtered[0].score.toFixed(2)})`);
                        
                        const [x, y, w, h] = filtered[0].bbox;
                        const m = this.aiCoordMap;
                        box = { 
                            x: m.offset.x + (x * m.scale), 
                            y: m.offset.y + (y * m.scale), 
                            w: w * m.scale, 
                            h: h * m.scale 
                        };
                    }
                }
            } catch(e) { console.error("[AI Error]", e); }
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
            // Ensure we don't try to draw outside the source video dimensions
            const maxW = this.internalSource.videoWidth;
            const maxH = this.internalSource.videoHeight;
            
            // Dynamic Resize: If source changes (rotation/quality switch), update canvas
            if (maxW && maxH && (this.canvas.width !== maxW || this.canvas.height !== maxH)) {
                this.canvas.width = maxW;
                this.canvas.height = maxH;
                // Reset view to full frame on resize
                this.vCam = { x: 0, y: 0, w: maxW, h: maxH };
                this.target = { ...this.vCam };
            }
            
            // Clamp coordinates to prevent "Source bounds" errors which cause black screens
            const sx = Math.max(0, this.vCam.x);
            const sy = Math.max(0, this.vCam.y);
            
            const sw = Math.min(this.vCam.w, maxW - sx);
            const sh = Math.min(this.vCam.h, maxH - sy);

            if (this.manualZoom > 1.0) {
                 // Debug only when zoomed in to avoid spam
                 // console.log(`[Zoom Debug] In: ${sx.toFixed(1)},${sy.toFixed(1)} ${sw.toFixed(1)}x${sh.toFixed(1)} | Max: ${maxW}x${maxH} | Ready: ${this.sourceVideo.readyState} | Canvas: ${this.canvas.width}x${this.canvas.height}`);
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
        
        // --- Initialize Remote Logging ---
        if (window.Logger) {
            window.Logger.init(socket, this.name);
            console.log(`[${this.name}] Remote Logger Active`);
        }

        this.stream = null;
        this.track = null;
        this.peers = {};
        this.uploader = new UploadManager(socket, (m) => { if(this.statusEl) this.statusEl.innerText = m; });
        this.tracker = new SmartTracker();
        this.settings = { deviceId: null, facingMode: 'environment', resolution: 1080, fps: 30, saveToHost: false, trackMode: 'off' };
        this.nativeAspectRatio = null; // Store native ratio to prevent cropping
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
            
            // --- Enhanced Capability Discovery ---
            // 1. Determine Max Height (Resolution)
            let maxHeight = 720; // Safe default
            if (caps.height && caps.height.max) {
                maxHeight = caps.height.max;
            } else if (this.stream) {
                // Fallback: use current stream size as "known good"
                const s = this.stream.getVideoTracks()[0].getSettings();
                if (s.height) maxHeight = s.height;
            }

            // 2. Generate Supported Resolutions List
            const standardRes = [720, 1080, 1440, 2160];
            const supportedRes = standardRes.filter(r => r <= maxHeight);
            // Ensure the current max is included if it's weird (like 1200)
            if (!supportedRes.includes(maxHeight) && maxHeight > 480) supportedRes.push(maxHeight);
            supportedRes.sort((a,b) => a - b);

            // 3. Detect Aspect Ratio
            let aspectRatio = 1.77; // Default 16:9
            if (this.videoEl && this.videoEl.videoWidth) {
                aspectRatio = this.videoEl.videoWidth / this.videoEl.videoHeight;
            } else if (caps.aspectRatio && caps.aspectRatio.max) {
                aspectRatio = caps.aspectRatio.max;
            }

            // Inject into caps object for Remote to use
            caps.supportedResolutions = supportedRes;
            caps.detectedAspectRatio = aspectRatio;

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
            // "No Crop" Strategy:
            // Most mobile sensors are 4:3 natively. 
            // If we ask for 16:9, we get a crop. 
            // If we ask for 4:3, we get the full sensor.
            const targetHeight = this.settings.resolution;
            // 1.3333 = 4:3 Aspect Ratio
            const targetWidth = Math.round(targetHeight * 1.3333333333);

            this.stream = await navigator.mediaDevices.getUserMedia({
                video: { 
                    deviceId: this.settings.deviceId ? { exact: this.settings.deviceId } : undefined, 
                    facingMode: this.settings.deviceId ? undefined : this.settings.facingMode, 
                    width: { ideal: targetWidth }, 
                    height: { ideal: targetHeight }, 
                    frameRate: { ideal: this.settings.fps } 
                },
                audio: true
            });
            
            // Log what we actually got
            const settings = this.stream.getVideoTracks()[0].getSettings();
            console.log(`[Camera] Started: ${settings.width}x${settings.height} (${(settings.width/settings.height).toFixed(2)})`);

            this.videoEl.srcObject = this.stream;
            // FORCE PLAY: Ensure the video element is actually processing frames
            this.videoEl.play().catch(e => { 
                // Ignore AbortError (interrupted by new load) which is harmless here
                if (e.name !== 'AbortError' && !e.message.includes('interrupted')) {
                    console.error("Local play error:", e);
                }
            });
            
            this.track = this.stream.getVideoTracks()[0];
            let out = this.stream;
            if (this.settings.trackMode !== 'off' || this.tracker.manualZoom > 1.0) { 
                this.tracker.setMode(this.settings.trackMode); 
                console.log(`[Tracker] Starting... Zoom: ${this.tracker.manualZoom}, Mode: ${this.settings.trackMode}`);
                out = this.tracker.start(this.videoEl, this.stream); 
                console.log(`[Tracker] Canvas Size: ${this.tracker.canvas.width}x${this.tracker.canvas.height}`);
                // Display the zoomed/processed stream on the local preview
                this.videoEl.srcObject = out;
            } else { 
                this.tracker.stop(); 
                this.videoEl.srcObject = this.stream; // Show raw feed if zoom is 1.0
            }
            this.refreshPeers(out);
        } catch(e) { 
            console.error(e);
            
            // Fallback for OverconstrainedError (hardware can't meet ideal specs)
            if (e.name === 'OverconstrainedError' || e.name === 'ConstraintNotSatisfiedError') {
                console.warn(`[Camera] Constraints failed (Mode: ${this.settings.facingMode}, Res: ${this.settings.resolution}). Falling back to basic config...`);
                try {
                    this.stream = await navigator.mediaDevices.getUserMedia({
                        video: true, // Auto-select best available
                        audio: true
                    });
                    // Re-run setup with the fallback stream
                    this.videoEl.srcObject = this.stream;
                    this.videoEl.play().catch(() => {});
                    this.track = this.stream.getVideoTracks()[0];
                    // IMPORTANT: Don't recurse excessively, just setup tracker and peers
                    let out = this.stream;
                    if (this.settings.trackMode !== 'off' || this.tracker.manualZoom > 1.0) { 
                        this.tracker.setMode(this.settings.trackMode); 
                        out = this.tracker.start(this.videoEl, this.stream); 
                        this.videoEl.srcObject = out;
                    }
                    this.refreshPeers(out);
                } catch (retryErr) {
                    console.error("Fallback also failed:", retryErr);
                }
            }
        }
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