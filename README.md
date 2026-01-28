# WiFi Camera Remote (Studio Edition)

> [!CAUTION]
> **Alpha Testing Stage:** This software is currently in active development. Features may change, and you may encounter bugs. Please report issues to help improve the system.

Turn your smartphones AND USB webcams into high-quality, wireless studio cameras with professional controls, ASMR-ready audio, and a **Multi-Camera Switcher** for OBS.

## 🚀 Quick Start (1-Click)

**macOS / Linux:**
1.  Double-click `Install_and_Run.command` in the project folder.
2.  That's it! It will install everything and launch the studio.

**Windows:**
1.  Ensure Node.js is installed.
2.  Double-click `start.bat` (create this if needed or run `npm start`).

## 💻 System Requirements

### Host Computer (Server)
*   **OS:** macOS, Windows 10/11, or Linux.
*   **Runtime:** [Node.js v18+](https://nodejs.org/) (Required).
*   **Network:** 5GHz WiFi or Gigabit Ethernet (Highly recommended for 4K video).
*   **Hardware:**
    *   CPU: Intel i5 (8th Gen) / Ryzen 5 / Apple M1 or better.
    *   RAM: 8GB recommended (especially if running OBS on the same machine).

### Mobile Devices (Cameras)
*   **Android:** Chrome (Latest). Android 10+. *USB Debugging required for Auto-Launch.*
*   **iOS:** Safari (Latest). iOS 15+ (Required for WebRTC).
*   **Hardware:**
    *   **4K Streaming:** Requires high-end devices (e.g., Pixel 6+, iPhone 12+, Galaxy S21+).
    *   **1080p Streaming:** Works on most modern smartphones (iPhone 8+, Pixel 3+).

## Key Features
- **Multi-Camera Support:** Connect unlimited phones and USB webcams.
- **Host Camera Hub:** Use your computer's USB webcams as studio inputs with full remote control and tracking.
- **OBS Switcher Dock:** A dedicated dock for OBS that shows live thumbnails of all cameras and lets you cut between them instantly.
- **AI Smart Tracking:** Face, Body, and Object tracking (keeps you or your product in frame automatically).
- **USB Data Transfer:** Offload 4K recordings directly to your computer (Tethered Mode).
- **Fault-Tolerant Recording:** "Smart Buffer" ensures you never lose a frame, even if the cable is unplugged.
- **Auto-Launch:** Plug in an Android phone, and the camera app opens automatically.

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
    *   **HTTP (OBS/Host):** Port 3002

## Connecting Cameras

### 1. Phones (WiFi or USB)
*   **Android:** Plug in via USB. The server will auto-detect it and launch the camera app.
*   **iOS:** Connect via USB (Personal Hotspot) or WiFi. Navigate to the IP shown in the terminal (e.g., `https://192.168.1.5:3001`).

### 2. USB Webcams (Host Hub)
1.  Open the **Host Hub** on your computer: `http://localhost:3002/host.html`
2.  Click **"Start"** on any connected webcam.
3.  These cameras now appear in the Remote and OBS Switcher just like phone cameras.

## OBS Studio Setup

### 1. Video Feed (Program View)
Add a **Browser Source** to your scene:
*   **URL:** `http://localhost:3002/obs.html`
*   **Size:** `1920x1080`
*   *This source automatically switches between "Grid View" and "Fullscreen" based on your commands.*

### 2. Studio Switcher Dock
Go to **Docks > Custom Browser Docks...**
*   **Name:** `Studio Switcher`
*   **URL:** `http://localhost:3002/control.html`
*   *Apply* and dock it into your OBS interface.

**Using the Switcher:**
*   **Click a Thumbnail:** Instantly cuts the Program View to that camera and selects it for control.
*   **Grid View Button:** Returns the Program View to the multi-camera grid.

## Advanced Features

### AI Smart Tracking
Select from three tracking modes to keep your subject in frame:
- **Face:** Locks onto the subject's head. Ideal for "talking head" videos.
- **Body:** Tracks the entire person. Good for standing presentations.
- **Object:** Ignores people and locks onto the largest inanimate object (phone, product, tool). Perfect for hands-only demos.

### High Fidelity Audio
Toggle between two audio profiles:
- **Voice Mode:** Optimizes for speech with Echo Cancellation and Noise Suppression (best for calls).
- **High Fidelity:** Disables all processing for raw, full-spectrum audio (best for ASMR, music, or professional mics).

### Fault-Tolerant Recording
The system uses a "Smart Buffer" to ensure zero frame loss:
- **Chunking:** Video is streamed in 1-second chunks.
- **Buffering:** If the connection slows down, chunks are queued in RAM.
- **Auto-Fallback:** If the network fails completely, the system seamlessly switches to **Local Storage Mode**, saving the full file to the device.

---
Created by Evan Beechem