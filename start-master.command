#!/bin/bash
# Double-click this file from Finder to start the flocking server as MASTER.
# The master controls all slave machines and accepts phone controller connections.

cd "$(dirname "$0")"

PORT=3000

# All dependency checks + auto-repair live in one place.
# shellcheck source=scripts/preflight.sh
source ./scripts/preflight.sh

# Get local IP for phone access
LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || echo "localhost")

echo ""
echo "  ╔══════════════════════════════════╗"
echo "  ║        MASTER SERVER             ║"
echo "  ╚══════════════════════════════════╝"
echo ""
echo "  Main:       http://localhost:$PORT/"
echo "  Phone:      http://$LOCAL_IP:$PORT/phone.html"
echo "  Slave link: ws://$LOCAL_IP:$PORT/slave-link"
echo ""
echo "  Give slaves this IP: $LOCAL_IP"
echo ""

# Open main page in Chrome
open -a "Google Chrome" "http://localhost:$PORT/"

node server/server.js "$PORT" --master
