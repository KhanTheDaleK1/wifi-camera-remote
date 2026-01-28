# WiFi Camera Remote (Studio Edition)

Turn your smartphone into a high-quality, wireless webcam with professional controls, ASMR-ready audio, and **Multi-Camera Studio** support for OBS.

## Key Features
- **Multi-Camera Support:** Connect multiple phones and see them all in OBS simultaneously.
- **USB Data Transfer:** Offload 4K recordings directly to your computer over a wired connection (Tethered Mode).
- **USB Live Feed:** Use ADB port-forwarding or USB Tethering for ultra-low latency, interference-free video in OBS.
- **Studio Controller:** Select which camera to control (Zoom, Focus, Lens) from a single dock.
- **Smart Auto-Tuning:** Automatically detects device capabilities and sets optimal resolution/bitrate.
- **Pro Audio:** Toggle between "Voice" (processing enabled) and "Pro" (raw/ASMR) audio modes.
- **Extreme Quality:** Up to 4K resolution at 250 Mbps bitrate (on supported devices).

## Installation
...
    ```
    *   **HTTPS (Phones):** Port 3001
    *   **HTTP (OBS):** Port 3002

## USB Connectivity (Recommended)
For the most stable connection and highest data speeds, use a wired USB connection.

### 1. Android (ADB Port Forwarding)
The "Gold Standard" for reliability. Works even in Airplane Mode.
1. Enable **USB Debugging** on your phone.
2. Connect via USB and run:
   ```bash
   ./usb-connect.sh
   ```
3. Open `https://localhost:3001` on your phone's Chrome browser.

### 2. iOS / Universal (USB Tethering)
1. Connect via USB.
2. Enable **Personal Hotspot (USB Only)** on iPhone or **USB Tethering** on Android.
3. When you run `npm start`, look for the IP labeled `(Likely USB/Ethernet)`.
4. Open that IP on your phone.

### 3. Tethered File Offload
Save 4K videos directly to your computer's hard drive:
1. Enable **"USB SAVE"** (Remote) or **"Tethered Mode"** (Control).
2. Record your video.
3. Upon stopping, the file is automatically moved to the `recordings/` folder on your computer.

## Usage Guide
...
    *   URL: `http://localhost:3002/control.html`
    *   *Use the dropdown at the top to select which camera to control.*

## Advanced Features

### Pro Audio Mode
Toggle between two audio profiles:
- **Voice Mode:** Optimizes for speech with Echo Cancellation and Noise Suppression (best for calls).
- **Pro Mode:** Disables all processing for raw, high-fidelity audio (best for ASMR or professional mics).

### Hardware Tiers
...

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