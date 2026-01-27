# WiFi Camera Remote (Studio Edition)

Turn your smartphone into a high-quality, wireless webcam with professional controls, ASMR-ready audio, and **Multi-Camera Studio** support for OBS.

## Key Features
- **Multi-Camera Support:** Connect multiple phones and see them all in OBS simultaneously.
- **Studio Controller:** Select which camera to control (Zoom, Focus, Lens) from a single dock.
- **Smart Auto-Tuning:** Automatically detects device capabilities (iPhone 6 vs Pixel 9 Pro) and sets optimal resolution/bitrate to prevent overheating.
- **ASMR Audio:** High-fidelity 320kbps audio with echo cancellation disabled for raw, natural sound.
- **Extreme Quality:** Up to 4K resolution at 250 Mbps bitrate (on supported devices).

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
    ```bash
    bash scripts/generate_cert.sh
    ```

4.  **Start the Server:**
    ```bash
    npm start
    ```
    *   **HTTPS (Phones):** Port 3001
    *   **HTTP (OBS):** Port 3002

## Usage Guide

### 1. Connect Cameras
1.  Open the HTTPS URL (e.g., `https://192.168.1.X:3001`) on each phone.
2.  Tap "Start Camera".
3.  The system will auto-detect your hardware tier (Legacy, Standard, or Ultra) and tune the stream.

### 2. OBS Setup (Studio Mode)
1.  **Video Feed:**
    *   Add a **Browser Source**.
    *   URL: `http://localhost:3002/obs.html`
    *   Size: `1920x1080` (or your canvas size).
    *   *This single source will display a grid of all connected cameras.*
2.  **Control Dock:**
    *   Go to **Docks** -> **Custom Browser Docks...**
    *   Name: `Studio Control`
    *   URL: `http://localhost:3002/control.html`
    *   *Use the dropdown at the top to select which camera to control.*

## Advanced Features

### Hardware Tiers
The app automatically assigns a tier based on your device's encoder capabilities:
- **Legacy (H.264):** 720p @ 30fps (Safe for older phones)
- **Standard (HEVC):** 1080p @ 60fps
- **Ultra (AV1):** 4K @ 60fps (Pixel 9 Pro / High-End)

### Thermal Protection
If the device starts to throttle (encoder latency > 25ms), the system will log a warning and automatically downgrade the stream to 720p to preserve the connection.

### Bitrate Control
In the Studio Dock, you can manually override the bitrate:
- **250M:** Extreme quality (Local recording mostly)
- **100M:** High quality streaming
- **50M:** Stable streaming
- **15M:** Standard (Good for weak Wi-Fi)

## Troubleshooting
- **No Video in OBS?** Refresh the Browser Source cache.
- **Controls not working?** Ensure you have selected the correct camera ID in the dock dropdown.
- **Audio Feedback?** Mute the OBS source monitoring or use headphones.

---
Created by Evan Beechem