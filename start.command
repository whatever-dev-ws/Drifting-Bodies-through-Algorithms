#!/bin/bash
# Double-click this file from Finder to start the flocking server.
# It serves the codebase, opens the main page + controls popup in Chrome,
# and prints the phone URL for scanning/sharing.

cd "$(dirname "$0")"

PORT=3000

# All dependency checks + auto-repair live in one place.
# shellcheck source=scripts/preflight.sh
source ./scripts/preflight.sh

# Get local IP for phone access
LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || echo "localhost")

echo ""
echo "  Starting flocking server on port $PORT..."
echo ""
echo "  Main:   http://localhost:$PORT/"
echo "  Phone:  http://$LOCAL_IP:$PORT/phone.html"
echo ""

# Open main page and controls in Chrome
open -a "Google Chrome" "http://localhost:$PORT/"

# Give the page a moment to load before it auto-opens controls popup
# (controls.html is opened by main.js as a popup)

node server/server.js "$PORT"
