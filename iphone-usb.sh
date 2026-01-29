#!/bin/bash
# iphone-usb.sh - Helper for iPhone Wired Connection

echo "--- iPhone USB Connection Helper ---"
echo "To get the lowest latency and high-speed 'USB Save' recording:"
echo ""
echo "1. Connect your iPhone to this Mac via USB cable."
echo "2. On your iPhone, go to Settings -> Personal Hotspot."
echo "3. Turn ON 'Allow Others to Join'."
echo "4. If prompted on the iPhone, tap 'Trust' this computer."
echo ""
echo "Checking for the connection..."

# Find the iPhone USB interface (usually starts with en and has a 172.20.x.x address)
IP=$(ifconfig | grep -A 1 "en" | grep "inet " | grep -E "172.20." | awk '{print $2}' | head -n 1)

if [ -z "$IP" ]; then
    echo "❌ iPhone USB Interface not found yet."
    echo "Make sure Personal Hotspot is ON and connected via USB."
else
    echo "✅ SUCCESS! Found iPhone Link at: $IP"
    echo "----------------------------------------"
    echo "On your iPhone, open Safari and go to:"
    echo "https://$IP:3001/camera.html"
    echo "----------------------------------------"
    echo "This link is now running over the high-speed USB cable."
fi
