// main.js — p5.js sketch lifecycle (global mode)
// WEBGL canvas + 2D overlay, Web Worker for simulation, TF.js pose detection

import { state, boidBaseSize, setHardwareLimits } from './state.js';
import { initPoseModel, startDetection, getBodyAgentsFlat, updatePrevKeypoints, videoTransform, getScaledPoses, getPoseCount } from './pose-tfjs.js';
import { initChannel, broadcastDevices } from './channel.js';
import { WebGLBoidRenderer, DebugOverlay } from './renderer.js';
import { GridAnalytics } from './grid-analytics.js';

// ── Startup camera gate ──────────────────────────────────────────────
// When on, no camera is opened until the operator picks one in the controls
// popup. When off, the default camera auto-starts as it did before the gate.
// Set to false to disable (auto-starts the default camera instead).
// NOTE: controls.js has a matching CAMERA_GATE_ENABLED flag. Both must agree.
const CAMERA_GATE_ENABLED = false;

let video;
let currentDeviceId = null;
// modelReady resolves once TF.js is loaded, so the model can warm up while we
// wait for a camera choice.
let detectionStarted = false;
let modelReady = null;

// WebGL renderer
let glRenderer;
let debugOverlay;

// Worker
let worker;
let workerBusy = false;
let positions = new Float32Array(0);   // latest from worker
let velocities = new Float32Array(0);
let localCOMs = new Float32Array(0);

// Path history ring buffer (main thread) — one position snapshot per frame,
// for EVERY boid (there used to be a 500-boid cap: boids past it never got a
// trail). seq[k] is the frame number of ring[k]; birth[i] is the frame
// boid index i (re)appeared — see onWorkerMessage.
const PATH_MAX = 100;
const pathData = { ring: [], seq: [], head: 0, frame: 0, birth: [], lastCount: 0 };

// Visualization modules
const gridAnalytics = new GridAnalytics();
let moodData = null;

// Overlay state
let perfEl = null;
let statusBarEl = null;
let perfUpdateTimer = 0;

// MediaRecorder
// The recorder never captures the on-screen canvases directly: boids live on
// p5's GL canvas and everything else (COM lines, trails, radii, skeleton,
// heatmaps, webcam) on the DebugOverlay canvas above it. Each recorded frame
// composites both into recCanvas, at a capped size and a fixed rate.
const REC_FPS = 30;
const REC_MAX_LONG = 1920;  // output long side, px
const REC_MAX_SHORT = 1080; // output short side, px
// First supported wins. H.264 goes to the hardware encoder (VideoToolbox on a
// Mac); VP8/VP9 are encoded in software on the CPU, VP9 most expensively.
const REC_FORMATS = [
  { mime: 'video/mp4;codecs=avc1.640028', ext: 'mp4' },
  { mime: 'video/mp4;codecs=avc1', ext: 'mp4' },
  { mime: 'video/webm;codecs=h264', ext: 'webm' },
  { mime: 'video/webm;codecs=vp8', ext: 'webm' },
  { mime: 'video/webm', ext: 'webm' },
];
let mediaRecorder = null;
let recordedChunks = [];
let wasRecording = false;
let recCanvas = null;     // composite target, captured with captureStream(0)
let recCtx = null;
let recTrack = null;      // its video track; frames are pushed via requestFrame()
let recNextFrame = 0;     // performance.now() at which the next frame is due
let pendingRecFilename = null; // filename chosen in the rename modal
let pendingRecBlobUrl = null;  // finished recording, held until a name is confirmed
let pendingRecExt = 'webm';    // container of the held recording

// Called from channel.js when the controls popup confirms (or defaults) a name.
// The recording is downloaded only once a name arrives, so the file is never
// saved before the user has had a chance to rename it.
export function setRecFilename(name) {
  pendingRecFilename = (name && String(name).trim()) || `flock-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
  finalizeRecordingDownload();
}

// Downloads the held recording once BOTH the blob and a filename are ready.
// Handles either arrival order (stop finishing before/after the name is chosen).
function finalizeRecordingDownload() {
  if (!pendingRecBlobUrl || pendingRecFilename === null) return;
  let name = pendingRecFilename;
  if (!name.toLowerCase().endsWith('.' + pendingRecExt)) name += '.' + pendingRecExt;
  const a = document.createElement('a');
  a.href = pendingRecBlobUrl;
  a.download = name;
  a.click();
  URL.revokeObjectURL(pendingRecBlobUrl);
  pendingRecBlobUrl = null;
  pendingRecFilename = null;
}

// State dirty tracking — avoid re-sending unchanged state every frame
let stateDirty = true;
let lastStateSent = null;

export function markStateDirty() {
  stateDirty = true;
}

export async function getVideoDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter(d => d.kind === 'videoinput')
    .map((d, i) => ({
      deviceId: d.deviceId,
      label: d.label || `Camera ${i + 1}`
    }));
}

export function triggerCameraPopup() {
  // no-op: camera popup removed
}

export function triggerFullscreen() {
  fullscreen(!fullscreen());
}

export async function switchCamera(deviceId) {
  if (!video || !video.elt) return;
  // Stop current tracks
  const oldStream = video.elt.srcObject;
  if (oldStream) oldStream.getTracks().forEach(t => t.stop());
  // Get new stream
  const newStream = await navigator.mediaDevices.getUserMedia({
    video: { deviceId: { exact: deviceId } },
    audio: false
  });
  video.elt.srcObject = newStream;
  await video.elt.play().catch(() => {});
  currentDeviceId = deviceId;
  // First camera the operator picks releases the startup gate.
  if (!detectionStarted) {
    detectionStarted = true;
    modelReady.then(() => startDetection(video));
  }
  // Re-enumerate and broadcast (labels may have changed)
  const devices = await getVideoDevices();
  broadcastDevices(devices, currentDeviceId);
}

// Bare <video> element standing in for p5's createCapture. Using createCapture
// would open the browser's default camera immediately, which is exactly what
// the startup gate exists to prevent — so the element starts with no stream
// and only gets one once switchCamera() is called.
function createVideoElement(w, h) {
  const elt = document.createElement('video');
  elt.autoplay = true;
  elt.muted = true;
  elt.playsInline = true;
  elt.setAttribute('playsinline', '');
  elt.style.display = 'none';
  document.body.appendChild(elt);
  const el = {
    elt,
    size(nw, nh) { elt.width = nw; elt.height = nh; },
    hide() { elt.style.display = 'none'; }
  };
  el.size(w, h);
  return el;
}

// Ask for camera permission without committing to a device, so enumerateDevices()
// returns real labels for the picker. With the gate on, the probe stream is
// dropped immediately and no camera runs until the operator picks one; with the
// gate off, the probe stream is kept, reproducing the old auto-start behaviour.
async function initCameraGate() {
  let probe = null;
  try {
    probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  } catch (err) {
    console.warn('[camera] permission denied or unavailable:', err);
  }

  if (CAMERA_GATE_ENABLED) {
    if (probe) probe.getTracks().forEach(t => t.stop());
  } else if (probe) {
    // Gate disabled: adopt the default camera the probe opened and go.
    video.elt.srcObject = probe;
    await video.elt.play().catch(() => {});
    const track = probe.getVideoTracks()[0];
    const settings = track ? track.getSettings() : null;
    if (settings && settings.deviceId) currentDeviceId = settings.deviceId;
    if (!detectionStarted) {
      detectionStarted = true;
      modelReady.then(() => startDetection(video));
    }
  }

  const devices = await getVideoDevices();
  // With the gate on, currentDeviceId stays null — the controls popup shows
  // "no camera" until the operator picks one.
  broadcastDevices(devices, currentDeviceId);
}

// --- p5 lifecycle (attached to window for global mode) ---

window.setup = function () {
  const w = windowWidth, h = windowHeight;

  createCanvas(w, h, WEBGL);

  video = createVideoElement(w, h);

  frameRate(60);

  // Channel (controls ↔ main)
  initChannel();

  // Init WebGL boid renderer using p5's underlying GL context
  const gl = drawingContext;
  glRenderer = new WebGLBoidRenderer(gl);
  // Boids are GL points, and the GPU silently clamps gl_PointSize to this
  // range. state.js clamps Size Offset to it so the UI shows the real size.
  const pointRange = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
  setHardwareLimits({ maxPointSize: pointRange[1] });
  console.log(`[gl] point size range ${pointRange[0]}–${pointRange[1]}px`);

  // 2D debug overlay — separate native canvas, not p5's GL context
  debugOverlay = new DebugOverlay(w, h);

  // Spawn Web Workers for flocking simulation
  worker = new Worker('./boid-worker.js', { type: 'module' });
  worker.onmessage = onWorkerMessage;
  // An exception inside the worker means no 'result' for that frame. Without
  // this, workerBusy never clears and the simulation freezes for good; with
  // it the next frame simply retries (the worker itself survives the error).
  worker.onerror = (e) => {
    console.error('[worker]', e.message);
    workerBusy = false;
  };

  // Load the TF.js model in the background while the operator picks a camera.
  // Assigned before initCameraGate() so switchCamera() can never see it unset.
  modelReady = initPoseModel();

  // Populate the camera picker, but open nothing. startDetection() is deferred
  // to switchCamera() — see initCameraGate().
  initCameraGate();
};

function onWorkerMessage(e) {
  const msg = e.data;
  if (msg.type === 'result') {
    positions = msg.positions;
    velocities = msg.velocities;
    localCOMs = msg.localCOMs;
    moodData = msg.mood || null;
    workerBusy = false;

    // Update path history. Trails are keyed by boid INDEX: the worker only
    // ever appends or truncates its boid array, so index i is the same boid
    // for as long as it lives.
    if (state.showPath) {
      const count = positions.length / 2;
      // Indices past last frame's count are new boids — including indices
      // reused after the population shrank and regrew. The ring still holds
      // the OLD boid's positions for them, so their trail starts here
      // (otherwise it would open with a line from the dead boid's spot).
      for (let i = pathData.lastCount; i < count; i++) pathData.birth[i] = pathData.frame;
      pathData.lastCount = count;

      // Snapshot every boid; reuse the slot's buffer when the size matches
      const slot = pathData.ring.length < PATH_MAX ? pathData.ring.length : pathData.head;
      let snap = pathData.ring[slot];
      if (!snap || snap.length !== count * 2) snap = new Float32Array(count * 2);
      snap.set(positions);
      pathData.ring[slot] = snap;
      pathData.seq[slot] = pathData.frame++;
      pathData.head = (pathData.head + 1) % PATH_MAX;
    } else {
      pathData.ring.length = 0;
      pathData.seq.length = 0;
      pathData.head = 0;
      pathData.lastCount = 0; // re-enabling starts every trail fresh
    }
  }
}

function startRecording() {
  // Output keeps the window's aspect, capped so a Retina or 4K canvas isn't
  // encoded at full size. Encoders need even dimensions. Fixed for the whole
  // take: a mid-recording window resize stretches rather than re-sizing.
  const scale = Math.min(1, REC_MAX_LONG / Math.max(width, height), REC_MAX_SHORT / Math.min(width, height));
  recCanvas = document.createElement('canvas');
  recCanvas.width = Math.max(2, Math.round(width * scale / 2) * 2);
  recCanvas.height = Math.max(2, Math.round(height * scale / 2) * 2);
  recCtx = recCanvas.getContext('2d', { alpha: false });

  // Rate 0: the browser captures nothing on its own, only on requestFrame()
  const stream = recCanvas.captureStream(0);
  recTrack = stream.getVideoTracks()[0];
  recNextFrame = 0;
  recordedChunks = [];

  const format = REC_FORMATS.find(f => MediaRecorder.isTypeSupported(f.mime))
    || { mime: '', ext: 'webm' };

  mediaRecorder = new MediaRecorder(stream, {
    mimeType: format.mime,
    videoBitsPerSecond: 8_000_000,
  });

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) recordedChunks.push(e.data);
  };

  mediaRecorder.onstop = () => {
    // Hold the finished recording — download waits until a name is confirmed.
    const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType });
    pendingRecBlobUrl = URL.createObjectURL(blob);
    pendingRecExt = format.ext;
    recordedChunks = [];
    mediaRecorder = null;
    stream.getTracks().forEach(t => t.stop());
    finalizeRecordingDownload(); // downloads now if a name was already chosen
  };

  mediaRecorder.start(1000); // collect in 1s chunks
  console.log(`[rec] started — ${format.mime || 'default'} ${recCanvas.width}×${recCanvas.height} @ ${REC_FPS}fps`);
}

// Called at the end of draw(), after both canvases are rendered for this frame
// (the GL buffer is only readable within the same task). Draws run at ~60fps;
// only every REC_FPS-th of a second is composited and handed to the encoder.
function captureRecordingFrame() {
  if (!recTrack || recTrack.readyState !== 'live') return;
  const now = performance.now();
  if (now < recNextFrame) return;
  // Schedule from the due time, not from now, so the rate doesn't drift; a
  // stall resets it instead of bursting to catch up.
  recNextFrame = Math.max(recNextFrame + 1000 / REC_FPS, now + 1000 / REC_FPS - 4);

  const w = recCanvas.width, h = recCanvas.height;
  recCtx.drawImage(drawingContext.canvas, 0, 0, w, h);
  if (debugOverlay.hasContent) recCtx.drawImage(debugOverlay.canvas, 0, 0, w, h);
  recTrack.requestFrame();
}

function stopRecording() {
  recTrack = null; // no more frames; onstop releases the stream
  recCanvas = recCtx = null;
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
    console.log('[rec] stopped — downloading');
  }
}

window.draw = function () {
  // Handle recording mode transitions
  if (state.recordingMode && !wasRecording) {
    wasRecording = true;
    startRecording();
  } else if (!state.recordingMode && wasRecording) {
    wasRecording = false;
    stopRecording();
  }

  // Clear WEBGL canvas
  background(state.canvasBgR, state.canvasBgG, state.canvasBgB);

  const dt = deltaTime / 16.6667;

  // Send simulation request to worker A (if not busy)
  // Body agents are only computed when actually sent — skips pose scaling +
  // smoothing work on frames where the worker is still busy.
  if (!workerBusy && worker) {
    workerBusy = true;

    // Flat body agents: [x, y, vx, vy, weight, radius, ...] stride=6
    const { data: bodyData, count: bodyCount } = getBodyAgentsFlat(width, height);

    const msg = {
      type: 'simulate',
      bodyAgents: bodyData,
      bodyAgentCount: bodyCount,
      canvasWidth: width,
      canvasHeight: height,
      deltaTime: dt,
    };

    if (stateDirty) {
      msg.state = { ...state };
    }

    worker.postMessage(msg);
    // Snapshot smoothed keypoints as "previous" AFTER they were consumed above,
    // so velocities span the full interval between simulation sends.
    updatePrevKeypoints();
  }

  if (stateDirty) stateDirty = false;

  // Render previous frame's data (1-frame lag — imperceptible)
  if (positions.length > 0 && state.showTriangle) {
    resetMatrix();

    const gl = drawingContext;
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Simulation size (shared with the worker's radii) + the visual-only
    // radius offset, which grows the diameter by 2× and nothing else.
    const pointSize = Math.max(1, boidBaseSize(state) + 2 * (state.boidRadiusOffset || 0));
    glRenderer.updatePositions(positions);

    if (state.showMoodColoring && moodData) {
      glRenderer.updateMood(moodData);
      glRenderer.renderMood(width, height, pointSize, state);
    } else {
      glRenderer.render(width, height, pointSize,
        state.boidR / 255, state.boidG / 255, state.boidB / 255, state.boidAlpha);
    }
  }

  // Grid analytics (shared computation for density, speed, flow field)
  let gridResult = null;
  if (positions.length > 0 && (state.showDensityHeatmap || state.showSpeedHeatmap || state.showVelocityFlowField)) {
    gridAnalytics.compute(positions, velocities, width, height, state.gridCellSize);
    gridResult = gridAnalytics;
  }

  // Debug overlay (native 2D canvas, independent of p5's GL)
  // Only build scaled pose objects when something on the overlay uses them.
  const vidTx = videoTransform(width, height);
  const scaledPoses = (state.showSkeleton || state.showActiveKeypoints)
    ? getScaledPoses(width, height)
    : null;
  debugOverlay.render(positions, velocities, localCOMs, pathData, state, video ? video.elt : null, vidTx, scaledPoses, gridResult);

  if (mediaRecorder) captureRecordingFrame();

  // Update perf overlay (~4 Hz to avoid layout thrash)
  perfUpdateTimer += deltaTime;
  if (perfUpdateTimer > 250) {
    perfUpdateTimer = 0;
    if (!perfEl) perfEl = document.getElementById('perf');
    if (!statusBarEl) statusBarEl = document.getElementById('status');
    // Status line ("Controls: … | TF.js: …") stays hidden — the overlay shows
    // boid and person counts only. Restore the toggle here to bring it back.
    if (statusBarEl) statusBarEl.style.display = 'none';
    if (!state.showPerformanceOverlay) {
      if (perfEl) perfEl.style.display = 'none';
    } else {
      if (perfEl) {
        perfEl.style.display = '';
        const boidCount = positions.length / 2;
        const personCount = getPoseCount();
        perfEl.textContent = `${boidCount} boids\n${personCount} ${personCount === 1 ? 'person' : 'people'}`;
      }
    }
  }
};

window.keyPressed = function () {
  if (key === 'f' || key === 'F') {
    fullscreen(!fullscreen());
  }
  if (key === '+') {
    state.triangleSize++;
    markStateDirty();
  }
  if (key === '-') {
    state.triangleSize = Math.max(1, state.triangleSize - 1);
    markStateDirty();
  }
};

window.windowResized = function () {
  resizeCanvas(windowWidth, windowHeight);
  debugOverlay.resize(windowWidth, windowHeight);
  if (video) {
    video.size(width, height);
  }
};
