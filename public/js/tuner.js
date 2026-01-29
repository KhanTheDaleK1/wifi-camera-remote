// tuner.js - Performance Monitor Fixes

class DeviceTuner {
    static async getOptimizedConstraints() {
        // Safe default for iPhone
        return { width: 1920, height: 1080, frameRate: 30, bitrate: 8000000 };
    }

    static startPerformanceMonitor(peer, sender, onAdjustment) {
        if (!peer || !sender) return;

        console.log('Tuner: Started monitor');
        const interval = setInterval(async () => {
            if (peer.connectionState !== 'connected') {
                clearInterval(interval);
                return;
            }

            try {
                const stats = await peer.getStats();
                stats.forEach(report => {
                    if (report.type === 'outbound-rtp' && report.kind === 'video') {
                        if (report.framesEncoded > 0 && report.totalEncodeTime) {
                            const avg = (report.totalEncodeTime * 1000) / report.framesEncoded;
                            if (avg > 35) { // Threshold for 30fps
                                console.warn(`Tuner: Lag detected (${avg.toFixed(1)}ms)`);
                                onAdjustment('downgrade');
                                clearInterval(interval);
                            }
                        }
                    }
                });
            } catch (e) {}
        }, 5000); 
    }
}