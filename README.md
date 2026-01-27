# WiFi Camera Remote

Turn your smartphone into a high-quality, wireless webcam with professional controls, ASMR-ready audio, and direct OBS integration.

## Features
- **High Quality Video:** Up to 4K resolution (device dependent) with high bitrate (250 Mbps target).
- **Pro Controls:** Manual focus, zoom, lens switching, and torch control.
- **ASMR Audio:** High-fidelity 320kbps audio with echo cancellation and noise suppression disabled for raw, natural sound.
- **Low Latency:** WebRTC-based streaming for near real-time performance.
- **OBS Integration:** Dedicated views for video feed and a custom control dock.
- **PWA Support:** Installable as a native-feeling app on your phone.

## Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/KhanTheDaleK1/wifi-camera-remote.git
    cd wifi-camera-remote
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Generate SSL Certificates:**
    (Required for camera access and PWA features)
    ```bash
    openssl req -nodes -new -x509 -keyout key.pem -out cert.pem -days 365 -subj "/C=US/ST=State/L=City/O=Organization/OU=Unit/CN=localhost"
    ```

4.  **Start the Server:**
    ```bash
    node server.js
    ```
    *Note: The server runs on HTTPS port 3001 (for phone) and HTTP port 3002 (for OBS).*

## Usage Guide

### 1. Connect Camera (Phone)
1.  Ensure your phone and computer are on the same Wi-Fi network.
2.  Open the **Server URL** displayed in your terminal (e.g., `https://192.168.1.X:3001`) on your phone.
3.  Accept the security warning (due to self-signed certificates).
4.  Click **"Start Camera"**.
5.  **Install PWA (Recommended):**
    *   **iOS:** Tap "Share" -> "Add to Home Screen".
    *   **Android:** Tap the menu (three dots) -> "Install app" or "Add to Home screen".
    *   *This prevents the phone from sleeping and hides browser UI bars.*

### 2. Connect Remote (Laptop/Tablet)
1.  Go to the same URL on another device.
2.  Click **"Open Remote"**.
3.  You can now see the feed and control zoom, focus, and recording.

### 3. OBS Setup
This tool is designed to work seamlessly with OBS Studio.

#### **Video Feed**
1.  Add a **Browser** source in OBS.
2.  Set URL to: `http://localhost:3002/obs.html` (or use your local IP instead of localhost if OBS is on a different machine).
3.  Set Width/Height to match your camera settings (e.g., `1920` x `1080`).
4.  Check **"Control audio via OBS"** to capture the ASMR audio.

#### **Control Dock**
1.  In OBS, go to **Docks** -> **Custom Browser Docks...**
2.  Name: `Camera Control`
3.  URL: `http://localhost:3002/control.html`
4.  Click **Apply**.
5.  You can now dock this panel anywhere in your OBS interface to control focus, zoom, and recording without leaving OBS.

## Advanced Settings
- **ASMR Audio:** The audio is configured for raw capture (no processing) at 320kbps. **Use headphones** to monitor to avoid feedback loops!
- **Video Quality:** The recorder attempts to use the efficient H.264 or VP9 codecs at a massive 250 Mbps bitrate for pristine recordings.

## Troubleshooting
- **Black Screen?** Ensure both devices are on the same network. Refresh the camera page first, then the remote/OBS.
- **Connection Failed?** Check your firewall settings to allow ports 3001 (TCP/UDP) and 3002.
- **Audio Feedback?** Mute the OBS source monitoring or use headphones.

---
Created by Evan Beechem
