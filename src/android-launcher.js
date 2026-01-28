const { exec } = require('child_process');
const platform = require('os').platform();

class AndroidLauncher {
    constructor() {
        this.knownDevices = new Set();
        this.interval = null;
    }

    start() {
        console.log('[Auto-Launch] Watching for Android devices...');
        this.checkDevices();
        this.interval = setInterval(() => this.checkDevices(), 3000); // Check every 3 seconds
    }

    stop() {
        if (this.interval) clearInterval(this.interval);
    }

    checkDevices() {
        exec('adb devices', (err, stdout) => {
            if (err) {
                // ADB might not be installed or path issue
                return; 
            }

            const currentDevices = new Set();
            const lines = stdout.split('\n').slice(1); // Skip first line "List of devices attached"

            lines.forEach(line => {
                const parts = line.split('\t');
                if (parts.length >= 2 && parts[1].trim() === 'device') {
                    const id = parts[0];
                    currentDevices.add(id);

                    if (!this.knownDevices.has(id)) {
                        this.handleNewDevice(id);
                    }
                }
            });

            this.knownDevices = currentDevices;
        });
    }

    handleNewDevice(id) {
        console.log(`[Auto-Launch] New Device Detected: ${id}`);
        
        // 1. Setup Port Forwarding
        exec('adb reverse tcp:3001 tcp:3001 && adb reverse tcp:3002 tcp:3002', (err) => {
            if (err) {
                console.error(`[Auto-Launch] Port forwarding failed for ${id}`);
                return;
            }
            console.log(`[Auto-Launch] Ports forwarded (3001/3002) for ${id}`);

            // 2. Launch Chrome
            // We use 'localhost' because we just forwarded the ports
            const url = "https://localhost:3001/camera.html";
            const cmd = `adb -s ${id} shell am start -a android.intent.action.VIEW -d "${url}"`;
            
            exec(cmd, (e) => {
                if (!e) console.log(`[Auto-Launch] 🚀 Launched Camera App on ${id}`);
            });
        });
    }
}

module.exports = new AndroidLauncher();
