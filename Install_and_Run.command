#!/bin/bash
cd "$(dirname "$0")"

echo "========================================"
echo "   WiFi Camera Remote - Studio Setup"
echo "========================================"

# 1. Check for Node.js
if ! command -v node &> /dev/null
then
    echo "❌ Node.js is not installed."
    echo "👉 Please install Node.js from https://nodejs.org/"
    echo "   (Download the LTS version)"
    read -p "Press any key to exit..."
    exit 1
fi

echo "✅ Node.js detected."

# 2. Install Dependencies (if needed)
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies (First run only)..."
    npm install
    if [ $? -ne 0 ]; then
        echo "❌ Installation failed."
        read -p "Press any key to exit..."
        exit 1
    fi
else
    echo "✅ Dependencies ready."
fi

# 3. Generate Certs (if needed)
if [ ! -f "certs/key.pem" ]; then
    echo "🔒 Generating SSL Certificates..."
    mkdir -p certs
    openssl req -newkey rsa:2048 -new -nodes -x509 -days 3650 -keyout certs/key.pem -out certs/cert.pem -subj "/C=US/ST=Studio/L=Studio/O=Camera/CN=localhost" 2>/dev/null
    echo "✅ Certificates created."
else
    echo "✅ SSL Certificates ready."
fi

# 4. Start Server
echo "========================================"
echo "🚀 Starting Server..."
echo "========================================"
echo "   Host Hub:   http://localhost:3002/host.html"
echo "   OBS Dock:   http://localhost:3002/control.html"
echo "========================================"

npm start
