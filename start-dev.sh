#!/bin/bash

# Quick start script for local mobile testing

echo "🚀 Starting Mutual Aid App for Mobile Testing"
echo ""

# Get local IP
IP=$(ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -1)

if [ -z "$IP" ]; then
    echo "⚠️  Could not detect local IP address"
    IP="YOUR_IP_ADDRESS"
else
    echo "✓ Detected local IP: $IP"
fi

echo ""
echo "📱 Access on your phone (same WiFi):"
echo "   http://$IP:5173"
echo ""
echo "🔧 Starting services..."
echo ""

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "🛑 Shutting down services..."
    kill $(jobs -p) 2>/dev/null
    exit
}

trap cleanup SIGINT SIGTERM

# Start backend in background
echo "1️⃣  Starting Backend API (port 5055)..."
cd training/peft
uvicorn slack_api:app --reload --host 0.0.0.0 --port 5055 &
BACKEND_PID=$!
cd ../..

# Wait a moment for backend to start
sleep 2

# Start frontend
echo "2️⃣  Starting Frontend Dev Server (port 5173)..."
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "   📱 SCAN QR CODE WITH YOUR PHONE OR VISIT:"
echo "      http://$IP:5173"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

npm run dev -- --host

# Cleanup when frontend exits
cleanup
