// tuner.js - Auto-detect and tune camera settings based on device capabilities

class DeviceTuner {
    static async getOptimizedConstraints() {
        if (!window.RTCRtpSender || !window.RTCRtpSender.getCapabilities) {
            console.warn('RTCRtpSender.getCapabilities not supported. Using safe defaults.');
            return { width: 1280, height: 720, frameRate: 30, bitrate: 2500000 };
        }

        const caps = RTCRtpSender.getCapabilities('video');
        
        // Tiered logic
        // Ultra Tier: AV1 Support (Pixel 9 Pro, high-end desktops)
        if (caps.codecs.find(c => c.mimeType.toLowerCase().includes('av1'))) {
            console.log('Tuner: Ultra Tier (AV1) detected');
            return { width: 3840, height: 2160, frameRate: 60, bitrate: 20000000 }; // 20 Mbps for streaming
        } 
        // Standard Tier: H.265 (HEVC) Support (iPhone 12+, modern Androids)
        else if (caps.codecs.find(c => c.mimeType.toLowerCase().includes('h265') || c.mimeType.toLowerCase().includes('hevc'))) {
            console.log('Tuner: Standard Tier (HEVC) detected');
            return { width: 1920, height: 1080, frameRate: 60, bitrate: 8000000 }; // 8 Mbps
        }
        
        // Legacy Tier: H.264 only (iPhone 6, older Androids)
        console.log('Tuner: Legacy Tier (H.264) detected');
        return { width: 1280, height: 720, frameRate: 30, bitrate: 2500000 }; // 2.5 Mbps
    }

    static startPerformanceMonitor(peer, sender, onAdjustment) {
        if (!peer || !sender) return;

        console.log('Tuner: Performance monitor started');
        const interval = setInterval(async () => {
            if (peer.connectionState !== 'connected') {
                clearInterval(interval);
                return;
            }

            try {
                const stats = await peer.getStats();
                let totalEncodeTime = 0;
                let framesEncoded = 0;

                stats.forEach(report => {
                    if (report.type === 'outbound-rtp' && report.kind === 'video') {
                        // totalEncodeTime is cumulative in seconds
                        totalEncodeTime = report.totalEncodeTime; 
                        framesEncoded = report.framesEncoded;
                    }
                });

                if (framesEncoded > 0) {
                    // Simple average over lifetime (better would be windowed, but this detects long-term strain)
                    const avgEncodeTime = (totalEncodeTime * 1000) / framesEncoded; // in ms
                    
                    // Thresholds: 30ms is dangerously close to 1/30s (33ms)
                    if (avgEncodeTime > 25) { 
                        console.warn(`Tuner: High encode latency detected (${avgEncodeTime.toFixed(2)}ms). Requesting dowotune.`);
                        onAdjustment('downgrade');
                        clearInterval(interval); // Stop monitoring after adjustment to prevent oscillating
                    }
                }
            } catch (e) {
                console.warn('Tuner: Stats error', e);
            }
        }, 2000); // Check every 2 seconds
    }
}
