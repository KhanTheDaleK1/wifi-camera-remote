# WiFi Camera Remote (Studio Edition)

> [!CAUTION]
> **Alpha Testing Stage:** This software is currently in active development. Features may change, and you may encounter bugs. Please report issues to help improve the system.

Turn your smartphones AND USB webcams into high-quality, wireless studio cameras with advanced controls, High-Fidelity audio, and a **Multi-Camera Switcher** for OBS.

## 🚀 Quick Start (1-Click)

**macOS / Linux:**
1.  Double-click `Install_and_Run.command` in the project folder.
2.  That's it! It will install dependencies, generate certificates, and launch the Studio Master Hub.

**Windows:**
1.  Ensure [Node.js](https://nodejs.org/) is installed.
2.  Open a terminal in the project folder and run `npm start`.

## 💻 System Requirements

### Host Computer (Server)
*   **OS:** macOS, Windows 10/11, or Linux.
*   **Runtime:** [Node.js v18+](https://nodejs.org/) (Required).
*   **Network:** 5GHz WiFi or Gigabit Ethernet (Highly recommended for 4K video).
*   **Hardware:**
    *   CPU: Intel i5 (8th Gen) / Ryzen 5 / Apple M1 or better.
    *   RAM: 8GB recommended (especially if running OBS on the same machine).

### Mobile Devices (Cameras)
*   **Android:** Chrome (Latest). Android 10+. *USB Debugging recommended for auto-launch.*
*   **iOS:** Safari (Latest). iOS 15+ (Required for WebRTC).
*   **Hardware:**
    *   **4K Streaming:** High-end devices (e.g., Pixel 6+, iPhone 12+, Galaxy S21+).
    *   **1080p Streaming:** Works on most modern smartphones (iPhone 8+, Pixel 3+).

## Key Features
- **Studio Master Hub:** A unified dashboard to manage unlimited phone and USB cameras, view live previews, and manage recordings.
- **Advanced Camera Remote:** Full control over focus, zoom, exposure, lens selection, and torch for any connected device.
- **OBS Switcher Dock:** A dedicated dock for OBS with live thumbnails to cut between cameras instantly.
- **AI Smart Tracking:** 
  - **Face:** Locks onto the subject's head (ideal for talking heads).
  - **Body:** Tracks the full person (great for presentations).
  - **Object:** Locks onto the largest object (perfect for product demos).
  - *New:* Features "Center Crop" processing for accurate tracking on mobile devices.
- **High-Fidelity Audio:** Toggle between "Voice" (processed) and "High-Fidelity" (raw, full-spectrum) audio modes.
- **Zero-Lag USB Tethering:** Use your iPhone's "Personal Hotspot" via USB for a wired, low-latency connection.
- **Robust Recording:** "Smart Buffer" technology ensures zero frame loss by queueing upload chunks if the network dips, with automatic fallback to local device storage.

## Usage

### 1. Launch the System
Run `npm start` (or use the 1-Click script).
- **Studio Master Hub:** `http://localhost:3002/studio.html` (Manage everything here)
- **OBS Clean Feed:** `http://localhost:3002/obs.html`
- **OBS Control Dock:** `http://localhost:3002/control.html`

### 2. Connect Phones
- **Scan QR Code:** The Studio Hub displays a QR code. Scan it with your phone to connect instantly.
- **USB Tethering (Recommended):** Connect your phone via USB, enable "Personal Hotspot" (iOS) or "USB Tethering" (Android), then scan the QR code. This provides a wired, interference-free connection.

### 3. Connect USB Webcams
1.  Open the **Studio Master Hub**.
2.  Click **"Rescan USB"**.
3.  Your connected webcams will appear in the grid.
4.  Click **"Start Hosting"** to broadcast that webcam to the network. It can now be controlled remotely just like a phone!

## OBS Studio Integration

### 1. Video Feed (Program View)
Add a **Browser Source** to your scene:
*   **URL:** `http://localhost:3002/obs.html`
*   **Size:** `1920x1080`
*   *This source automatically switches cameras based on your commands.*

### 2. Studio Control Dock
Go to **Docks > Custom Browser Docks...**
*   **Name:** `Camera Control`
*   **URL:** `http://localhost:3002/control.html`
*   *Apply* and dock it into your OBS interface.

**Using the Dock:**
*   **Thumbnails:** Click any camera thumbnail to switch the Program View to that camera.
*   **Controls:** Adjust zoom, focus, and trigger recordings directly from OBS.

---
Created by Evan Beechem
