#!/bin/bash
# vendor.sh — download every browser-side dependency into app/vendor/ so the
# installation runs with no internet connection and no CDN version drift.
#
# Run once while online:  ./scripts/vendor.sh
# Re-run to repair/refresh: ./scripts/vendor.sh --force
#
# Called automatically by preflight.sh when vendor/ is incomplete.

set -u
cd "$(dirname "$0")/.."   # project root

VENDOR="app/vendor"
MODEL_DIR="$VENDOR/movenet-multipose-lightning"
FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

# Pinned versions — change here, nowhere else.
P5_VER="1.9.4"
QR_VER="1.4.4"
TFJS_VER="4.22.0"
POSE_VER="2.1.3"
MODEL_BASE="https://tfhub.dev/google/tfjs-model/movenet/multipose/lightning/1"

mkdir -p "$MODEL_DIR"

fail=0

# fetch <dest> <url> [min_bytes]
fetch() {
  local dest="$1" url="$2" min="${3:-1024}"
  if [ $FORCE -eq 0 ] && [ -f "$dest" ]; then
    local have
    have=$(wc -c < "$dest" | tr -d ' ')
    if [ "$have" -ge "$min" ]; then
      echo "  ok       $dest ($have bytes)"
      return 0
    fi
    echo "  refetch  $dest (too small: $have bytes)"
  fi
  echo "  fetching $dest"
  if ! curl -fsSL --retry 3 --retry-delay 1 --connect-timeout 20 -o "$dest.tmp" "$url"; then
    echo "  FAILED   $dest  <- $url"
    rm -f "$dest.tmp"
    fail=1
    return 1
  fi
  local got
  got=$(wc -c < "$dest.tmp" | tr -d ' ')
  if [ "$got" -lt "$min" ]; then
    echo "  FAILED   $dest is only $got bytes (expected >= $min)"
    rm -f "$dest.tmp"
    fail=1
    return 1
  fi
  mv "$dest.tmp" "$dest"
  echo "  ok       $dest ($got bytes)"
}

echo ""
echo "Vendoring browser dependencies into $VENDOR/ ..."
echo ""

fetch "$VENDOR/p5.min.js" \
  "https://cdnjs.cloudflare.com/ajax/libs/p5.js/$P5_VER/p5.min.js" 500000
fetch "$VENDOR/qrcode.min.js" \
  "https://cdn.jsdelivr.net/npm/qrcode-generator@$QR_VER/qrcode.min.js" 5000
fetch "$VENDOR/tf-core.min.js" \
  "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-core@$TFJS_VER/dist/tf-core.min.js" 200000
fetch "$VENDOR/tf-backend-webgpu.min.js" \
  "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-webgpu@$TFJS_VER/dist/tf-backend-webgpu.min.js" 200000
fetch "$VENDOR/tf-converter.min.js" \
  "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-converter@$TFJS_VER/dist/tf-converter.min.js" 50000
fetch "$VENDOR/pose-detection.min.js" \
  "https://cdn.jsdelivr.net/npm/@tensorflow-models/pose-detection@$POSE_VER/dist/pose-detection.min.js" 50000

echo ""
echo "MoveNet MultiPose Lightning weights ..."
fetch "$MODEL_DIR/model.json" "$MODEL_BASE/model.json?tfjs-format=file" 10000
for s in group1-shard1of3.bin group1-shard2of3.bin group1-shard3of3.bin; do
  fetch "$MODEL_DIR/$s" "$MODEL_BASE/$s?tfjs-format=file" 100000
done

echo ""
if [ $fail -ne 0 ]; then
  echo "Vendoring INCOMPLETE — some downloads failed (see FAILED lines above)."
  echo "Re-run ./scripts/vendor.sh while online."
  exit 1
fi
echo "Vendoring complete. The installation can now run fully offline."
