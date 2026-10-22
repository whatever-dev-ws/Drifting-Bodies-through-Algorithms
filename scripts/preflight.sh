#!/bin/bash
# preflight.sh — dependency gate shared by start.command, start-master.command
# and start-slave.command. Sourced, not executed, so it can abort the caller.
#
# Checks and repairs, in order:
#   1. Node.js present
#   2. npm dependencies installed (auto-installs)
#   3. Google Chrome present
#   4. vendor/ browser dependencies complete (auto-downloads via vendor.sh)
#
# Anything it cannot repair is reported as a numbered problem and the launcher
# stops, rather than opening a browser onto a half-working installation.

# die <message...> — print, wait for the operator, close the Terminal window.
die() {
  echo ""
  echo "  ──────────────────────────────────────────────"
  for line in "$@"; do echo "  $line"; done
  echo "  ──────────────────────────────────────────────"
  echo ""
  read -r -p "Press Enter to close..."
  exit 1
}

echo ""
echo "  Checking dependencies..."

# ─── 0. Sibling launchers ─────────────────────────────────────────────────
# macOS quarantines anything arriving by download, AirDrop or unzip, and a
# quarantined .command refuses to open by double-click. This cannot rescue the
# launcher we are already running (quarantine blocks it before this file is
# sourced) but it does clear the OTHER launchers, so a machine only ever hits
# the Gatekeeper dialog once. Zip archives also drop the executable bit.
xattr -dr com.apple.quarantine ./*.command ./scripts/*.sh 2>/dev/null
chmod +x ./*.command ./scripts/*.sh 2>/dev/null

# ─── 1. Node.js ───────────────────────────────────────────────────────────
if ! command -v node &> /dev/null; then
  die "Node.js is not installed." \
      "" \
      "Install it from https://nodejs.org (LTS build)," \
      "or via Homebrew:  brew install node"
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)
if [ "$NODE_MAJOR" -lt 18 ]; then
  die "Node.js $(node -v) is too old — version 18 or newer is required." \
      "" \
      "Update from https://nodejs.org or via:  brew upgrade node"
fi
echo "    node        $(node -v)"

# ─── 2. npm dependencies ──────────────────────────────────────────────────
# package.json and node_modules/ live in server/, next to server.js.
# Subshells keep the caller's working directory at the project root.
if ! (cd server && node -e "require('ws')") 2>/dev/null; then
  echo "    npm deps    missing — installing..."
  if ! command -v npm &> /dev/null; then
    die "npm is not installed, so the 'ws' package cannot be installed." \
        "" \
        "Reinstall Node.js from https://nodejs.org — it bundles npm."
  fi
  # npm ci is reproducible but needs the lockfile in sync; fall back to install.
  if [ -f server/package-lock.json ]; then
    (cd server && { npm ci --silent 2>/dev/null || npm install --silent; })
  else
    (cd server && npm install --silent)
  fi
  if ! (cd server && node -e "require('ws')") 2>/dev/null; then
    die "Failed to install the 'ws' package." \
        "" \
        "Run this by hand in the server/ folder and read the error:" \
        "" \
        "  cd server && npm install"
  fi
fi
echo "    ws          $(cd server && node -p "require('ws/package.json').version")"

# ─── 3. Google Chrome ─────────────────────────────────────────────────────
# The rig needs Chrome specifically: WebGPU + the MoveNet WebGPU backend.
if [ ! -d "/Applications/Google Chrome.app" ] && \
   [ ! -d "$HOME/Applications/Google Chrome.app" ]; then
  die "Google Chrome is not installed." \
      "" \
      "This installation requires Chrome — it uses WebGPU for pose detection," \
      "which Safari does not support." \
      "" \
      "Install from https://google.com/chrome" \
      "or via Homebrew:  brew install --cask google-chrome"
fi
echo "    chrome      found"

# ─── 4. Vendored browser dependencies ─────────────────────────────────────
# p5, the TF.js stack and the MoveNet weights are served from app/vendor/ so
# the rig runs with no internet and never drifts with a CDN release.
VENDOR_OK=1
check_vendor() {
  local f="app/vendor/$1" min="$2" have
  [ -f "$f" ] || { VENDOR_OK=0; return; }
  have=$(wc -c < "$f" | tr -d ' ')
  [ "$have" -ge "$min" ] || VENDOR_OK=0
}
check_vendor "p5.min.js"                                    500000
check_vendor "qrcode.min.js"                                  5000
check_vendor "tf-core.min.js"                               200000
check_vendor "tf-backend-webgpu.min.js"                     200000
check_vendor "tf-converter.min.js"                           50000
check_vendor "pose-detection.min.js"                         50000
check_vendor "movenet-multipose-lightning/model.json"        10000
check_vendor "movenet-multipose-lightning/group1-shard1of3.bin" 100000
check_vendor "movenet-multipose-lightning/group1-shard2of3.bin" 100000
check_vendor "movenet-multipose-lightning/group1-shard3of3.bin" 100000

if [ "$VENDOR_OK" -eq 0 ]; then
  echo "    vendor/     incomplete — downloading (needs internet, ~12 MB)..."
  if [ ! -x ./scripts/vendor.sh ]; then
    die "app/vendor/ is incomplete and scripts/vendor.sh is missing or not executable." \
        "" \
        "Restore it, then run:  chmod +x scripts/vendor.sh && ./scripts/vendor.sh"
  fi
  if ! ./scripts/vendor.sh; then
    die "Could not download the browser dependencies." \
        "" \
        "The rig cannot run without them. Connect this machine to the" \
        "internet once and run:  ./scripts/vendor.sh" \
        "" \
        "After that it runs offline forever."
  fi
fi
echo "    vendor/     complete"
echo "  All dependencies present."
