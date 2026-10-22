#!/bin/bash
# Double-click this file from Finder to start the flocking server as SLAVE.
# The slave receives state updates from the master machine.

cd "$(dirname "$0")"

PORT=3000

# ─── Default master IP (edit this to match your master machine) ───
DEFAULT_MASTER_IP="192.168.1.100"

# All dependency checks + auto-repair live in one place.
# shellcheck source=scripts/preflight.sh
source ./scripts/preflight.sh

echo ""
echo "  ╔══════════════════════════════════╗"
echo "  ║         SLAVE SERVER             ║"
echo "  ╚══════════════════════════════════╝"
echo ""
read -p "  Master IP [$DEFAULT_MASTER_IP]: " MASTER_IP
MASTER_IP=${MASTER_IP:-$DEFAULT_MASTER_IP}

LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || echo "localhost")

echo ""
echo "  Local:   http://localhost:$PORT/"
echo "  Master:  $MASTER_IP:$PORT"
echo ""

# Open main page in Chrome
open -a "Google Chrome" "http://localhost:$PORT/"

node server/server.js "$PORT" --slave "$MASTER_IP"
