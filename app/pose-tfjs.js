// pose-tfjs.js — pose detection via raw TensorFlow.js + pose-detection library
// Replaces ml5.js with direct TF.js for WebGPU/WebGL backend access

import { state } from './state.js';

// MoveNet MultiPose Lightning weights, vendored by vendor.sh.
// Root-relative so controls.html / scenes.html resolve it the same way.
const MOVENET_MODEL_URL = '/vendor/movenet-multipose-lightning/model.json';

// Dynamic active keypoints — reads from state.kp0..kp16
// Reuses one array to avoid per-call allocation (called several times per frame)
const _activeKps = [];
export function getActiveKeypoints() {
  _activeKps.length = 0;
  for (let i = 0; i < 17; i++) {
    if (state['kp' + i]) _activeKps.push(i);
  }
  return _activeKps;
}

// MoveNet skeleton connections (pairs of keypoint indices)
export const SKELETON_CONNECTIONS = [
  [0, 1], [0, 2], [1, 3], [2, 4],   // face
  [5, 6],                             // shoulders
  [5, 7], [7, 9],                     // left arm
  [6, 8], [8, 10],                    // right arm
  [5, 11], [6, 12],                   // torso
  [11, 12],                           // hips
  [11, 13], [13, 15],                 // left leg
  [12, 14], [14, 16],                 // right leg
];

let detector = null;
let poses = [];
let prevKeypoints = new Map();
let smoothedKeypoints = new Map();
let videoEl = null;
let detecting = false;
let reinitializing = false;

// Track model-level params that require detector reinit
let lastMinPoseScore = -1;
let lastMultiPoseMaxDim = -1;

// Cached videoTransform per frame (invalidated each draw call)
let cachedVidTx = null;
let cachedVidTxW = -1;
let cachedVidTxH = -1;
let cachedVidTxFill = null;
let cachedVidTxVW = -1;
let cachedVidTxVH = -1;

// Called from setup() — loads TF.js backend + MoveNet model
export async function initPoseModel() {
  // WebGPU backend
  await tf.setBackend('webgpu');
  await tf.ready();
  console.log('TF.js backend: WebGPU');

  // Update status element
  const statusEl = document.getElementById('status');
  if (statusEl) {
    statusEl.innerHTML = `Controls: <span id="conn">connecting…</span> | TF.js: WebGPU`;
  }

  await createDetectorWithCurrentState();
}

async function createDetectorWithCurrentState() {
  lastMinPoseScore = state.minPoseScore;
  lastMultiPoseMaxDim = state.multiPoseMaxDimension;
  detector = await poseDetection.createDetector(
    poseDetection.SupportedModels.MoveNet,
    {
      // Use string literal — poseDetection.movenet.MULTIPOSE_LIGHTNING is at
      // .movenet.modelType.MULTIPOSE_LIGHTNING in the CDN build, not .movenet.MULTIPOSE_LIGHTNING
      modelType: 'MultiPose.Lightning',
      // Weights served from vendor/ instead of tfhub.dev. Without this the
      // detector downloads ~9 MB from Google on every cold start, so the rig
      // needs internet to boot. A modelUrl that isn't a tfhub.dev URL makes
      // pose-detection load the weight shards relative to model.json.
      modelUrl: MOVENET_MODEL_URL,
      enableSmoothing: false, // we do our own smoothing
      minPoseScore: state.minPoseScore,
      multiPoseMaxDimension: state.multiPoseMaxDimension,
    }
  );
  console.log('MoveNet MultiPose Lightning loaded (minPoseScore:', state.minPoseScore,
    'maxDim:', state.multiPoseMaxDimension + ')');
}

// Reinitialize detector when model-level params change
async function reinitDetector() {
  if (reinitializing) return;
  reinitializing = true;
  try {
    if (detector) {
      detector.dispose();
      detector = null;
    }
    await createDetectorWithCurrentState();
    console.log('Detector reinited (minPoseScore:', state.minPoseScore,
      'maxDim:', state.multiPoseMaxDimension + ')');
  } catch (e) {
    console.error('Detector reinit failed:', e);
  }
  reinitializing = false;
}

// Called from setup() — starts continuous detection on the video element
export function startDetection(video) {
  videoEl = video.elt || video;
  if (detector && !detecting) {
    detecting = true;
    detectLoop();
  }
}

async function detectLoop() {
  if (!detecting || !videoEl) return;
  // Reinit detector if model-level params changed
  if ((state.minPoseScore !== lastMinPoseScore ||
       state.multiPoseMaxDimension !== lastMultiPoseMaxDim) && !reinitializing) {
    await reinitDetector();
  }
  if (!detector) { requestAnimationFrame(detectLoop); return; }
  try {
    if (videoEl.readyState >= 2) {
      const results = await detector.estimatePoses(videoEl);
      poses = (results || []).slice(0, state.maxPoses);
    }
  } catch (e) {
    // Silently skip frames where detection fails (e.g. video not ready)
  }
  requestAnimationFrame(detectLoop);
}

// Compute video→canvas transform (cached per frame)
export function videoTransform(canvasW, canvasH) {
  const vw = videoEl ? (videoEl.videoWidth || canvasW) : canvasW;
  const vh = videoEl ? (videoEl.videoHeight || canvasH) : canvasH;
  if (cachedVidTx && cachedVidTxW === canvasW && cachedVidTxH === canvasH &&
      cachedVidTxFill === state.webcamFill && cachedVidTxVW === vw && cachedVidTxVH === vh) {
    return cachedVidTx;
  }
  const scale = state.webcamFill
    ? Math.max(canvasW / vw, canvasH / vh)
    : Math.min(canvasW / vw, canvasH / vh);
  cachedVidTx = {
    scale,
    offsetX: (canvasW - scale * vw) / 2,
    offsetY: (canvasH - scale * vh) / 2,
    vw,
    vh,
  };
  cachedVidTxW = canvasW;
  cachedVidTxH = canvasH;
  cachedVidTxFill = state.webcamFill;
  cachedVidTxVW = vw;
  cachedVidTxVH = vh;
  return cachedVidTx;
}

function kpKey(i, k) { return i * 100 + k; }

// Plain {x,y} objects mutated in place — no per-frame allocation (was p5.Vector)
function getSmoothed(i, k, x, y) {
  const key = kpKey(i, k);
  let cur = smoothedKeypoints.get(key);
  if (!cur) {
    cur = { x, y };
    smoothedKeypoints.set(key, cur);
  } else {
    const smooth = state.kpSmoothing;
    cur.x += (x - cur.x) * smooth;
    cur.y += (y - cur.y) * smooth;
  }
  return cur;
}

// Returns body agents as a flat Float32Array: [x, y, vx, vy, weightMult, radiusMult, ...] stride=6
let bodyAgentBuf = new Float32Array(6 * 17 * 6);
function ensureBodyBuf(needed) {
  if (bodyAgentBuf.length < needed) bodyAgentBuf = new Float32Array(needed);
}

export function getBodyAgentsFlat(canvasW, canvasH) {
  const t = videoTransform(canvasW, canvasH);
  const minConf = state.kpConfidence;
  let count = 0;
  const activeKps = getActiveKeypoints();
  const poseCount = poses.length;
  ensureBodyBuf(poseCount * activeKps.length * 6);
  for (let i = 0; i < poseCount; i++) {
    const kps = poses[i].keypoints;
    for (let idx = 0; idx < activeKps.length; idx++) {
      const k = activeKps[idx];
      const kp = kps[k];
      if (kp && kp.score > minConf) {
        let scaledX = kp.x * t.scale + t.offsetX;
        const scaledY = kp.y * t.scale + t.offsetY;
        if (state.webcamMirror) scaledX = canvasW - scaledX;
        const p = getSmoothed(i, k, scaledX, scaledY);
        const prev = prevKeypoints.get(kpKey(i, k)) || p; // read-only: fallback to p → zero velocity
        const base = count * 6;
        bodyAgentBuf[base]     = p.x;
        bodyAgentBuf[base + 1] = p.y;
        bodyAgentBuf[base + 2] = p.x - prev.x;
        bodyAgentBuf[base + 3] = p.y - prev.y;
        // ?? not || — a slider at 0 must mean 0, not fall back to 1
        bodyAgentBuf[base + 4] = state['kp' + k + 'Weight'] ?? 1.0;
        bodyAgentBuf[base + 5] = state['kp' + k + 'Radius'] ?? 1.0;
        count++;
      }
    }
  }
  return { data: bodyAgentBuf, count };
}

export function updatePrevKeypoints() {
  const minConf = state.kpConfidence;
  const activeKps = getActiveKeypoints();
  const count = poses.length;
  for (let i = 0; i < count; i++) {
    const pose = poses[i];
    const kps = pose.keypoints;
    for (let idx = 0; idx < activeKps.length; idx++) {
      const k = activeKps[idx];
      const kp = kps[k];
      if (kp && kp.score > minConf) {
        const key = kpKey(i, k);
        const sm = smoothedKeypoints.get(key);
        if (sm) {
          let prev = prevKeypoints.get(key);
          if (!prev) {
            prevKeypoints.set(key, { x: sm.x, y: sm.y });
          } else {
            prev.x = sm.x;
            prev.y = sm.y;
          }
        }
      }
    }
  }
}

// Returns all poses with keypoints scaled to canvas space (for skeleton rendering)
// Number of people currently tracked (already capped at state.maxPoses)
export function getPoseCount() {
  return poses.length;
}

export function getScaledPoses(canvasW, canvasH) {
  const t = videoTransform(canvasW, canvasH);
  const count = poses.length;
  const out = [];
  for (let i = 0; i < count; i++) {
    const kps = poses[i].keypoints;
    const mirror = state.webcamMirror;
    const scaled = kps.map(kp => ({
      x: mirror ? (canvasW - (kp.x * t.scale + t.offsetX)) : (kp.x * t.scale + t.offsetX),
      y: kp.y * t.scale + t.offsetY,
      score: kp.score,
    }));
    out.push({ keypoints: scaled });
  }
  return out;
}
