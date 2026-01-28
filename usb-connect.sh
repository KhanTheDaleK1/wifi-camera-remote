#!/bin/bash
echo "--- USB Live Feed Helper (Android) ---"
echo "This script sets up ADB Port Forwarding for a perfect wired connection."
echo "Ensure 'USB Debugging' is enabled on your phone."
echo "----------------------------------------"

if ! command -v adb &> /dev/null
then
    echo "Error: 'adb' command not found."
    echo "Please install Android Platform Tools (brew install android-platform-tools)"
    exit 1
fi

echo "Checking for connected devices..."
adb devices

echo ""
echo "Setting up port forwarding..."
# Forward HTTPS (3001) and HTTP (3002)
adb reverse tcp:3001 tcp:3001
adb reverse tcp:3002 tcp:3002

if [ $? -eq 0 ]; then
    echo "----------------------------------------"
    echo "SUCCESS! Connection Established."
    echo "----------------------------------------"
    echo "On your PHONE, open Chrome and go to:"
    echo "https://localhost:3001"
    echo ""
    echo "This connection is now running exclusively over the USB cable."
    echo "Your OBS feed on this computer (http://localhost:3002/obs.html)"
    echo "will receive the video stream with zero wireless interference."
else
    echo "Forwarding failed. Please check your USB connection and permissions."
fi
