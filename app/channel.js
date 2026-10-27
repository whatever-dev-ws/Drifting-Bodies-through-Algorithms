// channel.js — BroadcastChannel setup + WebSocket bridge, wired to state.js

import { getState, setKey, isNumericKey, isBoolKey } from './state.js';
import { markStateDirty, switchCamera, getVideoDevices, triggerCameraPopup, triggerFullscreen, setRecFilename, refreshDisplay } from './main.js';

let chan = null;
let lastDeviceList = null;
let lastCurrentDeviceId = null;
let ws = null;
// Phone controller mapping, as last published by the phone. Held here (the
// only BroadcastChannel↔WebSocket bridge) so the controls window gets it
// even if it opens after the phone, and can export it as a scene's `_phone`.
let lastPhoneLayout = null;
// This machine's name and role (from /api/role), carried by display reports
// so the master's controls window can tell the machines apart.
let machine = { host: '', ip: '', role: '' };

// ── Scene slew engine (main-thread side) ─────────────────────────────
// Handles smooth transitions when a load-scene message arrives.
let sceneSlewDuration = 2.0; // seconds — editable from scene manager
let sceneSlewCurve = 'ease-out-cubic';
let sceneFadeTransitions = false;
const SLEW_CURVES = {
  'linear':         t => t,
  'ease-in':        t => t * t,
  'ease-out':       t => 1 - (1 - t) * (1 - t),
  'ease-in-out':    t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
  'ease-out-cubic': t => 1 - Math.pow(1 - t, 3),
  'ease-in-cubic':  t => t * t * t,
  'exponential':    t => t === 0 ? 0 : Math.pow(2, 10 * (t - 1)),
  'logarithmic':    t => Math.log(1 + t * (Math.E - 1)),
};
const slewTargets = new Map(); // key → { from, to, startTime, duration }
let slewRAF = null;

// Transition indicator for the scene manager. Announced on change only, so
// the scene manager can show "transitioning" without polling.
let slewActive = false;
function setSlewActive(active) {
  if (active === slewActive) return;
  slewActive = active;
  if (chan) chan.postMessage({ type: 'slew-status', active });
}

// Setup-panel parameters are excluded from scenes — they configure the rig
// (camera, detector, diagnostics), not the look. Scene files exported before
// this change may still carry them, so filter here as well as in controls.js.
// Mirrors SCENE_EXCLUDED_KEYS there, which derives the same set from the
// sections with tab:"settings". Keep the two in sync.
// Keypoint weights/radii are NOT here — which joints attract boids is scene
// content, not rig setup.
// The same set is also per MACHINE: every slave runs its own camera and pose
// detection, so master updates (tagged `fromMaster` by the slave server)
// never overwrite these keys on a slave — see isMasterRigKey().
const SETTINGS_KEYS = new Set([
  'cameraDeviceId', 'showVideo', 'webcamFill', 'webcamMirror',
  'showPerformanceOverlay',
  'minPoseScore', 'multiPoseMaxDimension', 'maxPoses', 'kpConfidence', 'kpSmoothing',
]);

// A master message touching this machine's rig settings: skip it. Local
// traffic (this machine's controls or phones) carries no tag and applies.
function isMasterRigKey(msg, key) {
  return msg.fromMaster === true && SETTINGS_KEYS.has(key);
}

function startSceneSlew(sceneData) {
  const current = getState();
  const now = performance.now();
  const dur = sceneSlewDuration * 1000;
  const boidCountChanging = sceneFadeTransitions && dur > 0
    && sceneData.boidCount !== undefined
    && +sceneData.boidCount !== current.boidCount;
  const targetAlpha = sceneData.boidAlpha !== undefined ? +sceneData.boidAlpha : current.boidAlpha;

  for (const [key, value] of Object.entries(sceneData)) {
    if (key.startsWith('_')) continue;
    if (SETTINGS_KEYS.has(key)) continue;
    if (isBoolKey(key) || (typeof value === 'string' && value.startsWith('#'))) {
      setKey(key, value);
      markStateDirty();
      continue;
    }
    if (!isNumericKey(key)) {
      setKey(key, value);
      markStateDirty();
      continue;
    }

    if (boidCountChanging && (key === 'boidCount' || key === 'boidAlpha')) continue;

    const from = current[key];
    const to = +value;
    if (from === undefined || isNaN(from) || from === to) {
      setKey(key, value);
      markStateDirty();
      continue;
    }
    slewTargets.set(key, { from, to, startTime: now, duration: dur });
  }

  if (boidCountChanging) {
    slewTargets.set('boidAlpha', {
      from: current.boidAlpha, to: targetAlpha, startTime: now, duration: dur,
      fade: true, midValue: +sceneData.boidCount, midApplied: false
    });
  }

  if (slewTargets.size > 0 && !slewRAF) {
    slewRAF = requestAnimationFrame(slewTick);
  }
  setSlewActive(slewTargets.size > 0);
  broadcastState('snapshot');
}

function slewTick(timestamp) {
  const easeFn = SLEW_CURVES[sceneSlewCurve] || SLEW_CURVES['ease-out-cubic'];
  for (const [key, s] of slewTargets.entries()) {
    // rAF's timestamp can predate the performance.now() taken in
    // startSceneSlew; clamp at 0 or the first frame overshoots past `from`.
    const t = Math.max(0, Math.min((timestamp - s.startTime) / s.duration, 1));
    if (s.fade) {
      if (t < 0.5) {
        const fadeOut = easeFn(t * 2);
        setKey(key, s.from * (1 - fadeOut));
      } else {
        if (!s.midApplied) {
          setKey('boidCount', s.midValue);
          s.midApplied = true;
        }
        const fadeIn = easeFn((t - 0.5) * 2);
        setKey(key, s.to * fadeIn);
      }
    } else {
      const eased = easeFn(t);
      // Land exactly on the target: from + (to − from) × 1 is not `to` in
      // floating point (0.8 → 0.3 ended at 0.30000000000000004)
      const val = t >= 1 ? s.to : s.from + (s.to - s.from) * eased;
      setKey(key, val);
    }
    if (t >= 1) slewTargets.delete(key);
  }
  markStateDirty();
  broadcastState('state');
  if (slewTargets.size > 0) {
    slewRAF = requestAnimationFrame(slewTick);
  } else {
    slewRAF = null;
    setSlewActive(false);
  }
}

// Helper: broadcast state to both BroadcastChannel and WebSocket
function broadcastState(type) {
  const msg = { type, state: getState() };
  if (chan) chan.postMessage(msg);
  wsSend(msg);
}

// --- Handle an incoming message (from BroadcastChannel or WebSocket) ---
function handleMessage(msg, source) {
  if (!msg.type) return;

  if (msg.type === 'hello') {
    const statusEl = document.getElementById('conn');
    if (statusEl) statusEl.textContent = 'connected';
    const snapshot = { type: 'snapshot', state: getState() };
    chan.postMessage(snapshot);
    wsSend(snapshot);
    if (lastDeviceList) {
      const devMsg = { type: 'devices', devices: lastDeviceList, currentDeviceId: lastCurrentDeviceId };
      chan.postMessage(devMsg);
      wsSend(devMsg);
    }
    if (lastPhoneLayout) chan.postMessage({ type: 'phone-layout', layout: lastPhoneLayout });
  } else if (msg.type === 'set' && msg.key !== undefined) {
    if (isMasterRigKey(msg, msg.key)) return;
    setKey(msg.key, msg.value);
    markStateDirty();
    const stateMsg = { type: 'state', state: getState() };
    chan.postMessage(stateMsg);
    wsSend(stateMsg);
  } else if (msg.type === 'sync') {
    const snapshot = { type: 'snapshot', state: getState() };
    chan.postMessage(snapshot);
    wsSend(snapshot);
  } else if (msg.type === 'switch-camera' && msg.deviceId) {
    switchCamera(msg.deviceId);
  } else if (msg.type === 'request-devices') {
    getVideoDevices().then(devices => {
      if (devices.length > 0) broadcastDevices(devices, lastCurrentDeviceId);
    });
  } else if ((msg.type === 'state' || msg.type === 'snapshot') && msg.state && source === 'ws') {
    // Apply incoming state from master (via slave relay)
    const incoming = msg.state;
    for (const key of Object.keys(incoming)) {
      if (isMasterRigKey(msg, key)) continue; // this slave's own camera/detection
      setKey(key, incoming[key]);
    }
    markStateDirty();
    // Forward to controls popup so its UI updates, but don't echo back via WS
    chan.postMessage({ type: 'snapshot', state: getState() });
  } else if (msg.type === 'sync-slaves') {
    // Master: push full state to slaves via WS (server relays to slave connections)
    const snapshot = { type: 'snapshot', state: getState() };
    wsSend(snapshot);
  } else if (msg.type === 'sync-to-master') {
    // Slave: request full state from master via WS
    wsSend({ type: 'sync-to-master' });
  } else if (msg.type === 'load-scene' && msg.state) {
    startSceneSlew(msg.state); // skips `_` keys, so _phone never reaches state
    if (msg.state._phone) wsSend({ type: 'phone-layout-apply', layout: msg.state._phone });
  } else if (msg.type === 'phone-layout' && source === 'ws') {
    lastPhoneLayout = msg.layout || null;
    chan.postMessage({ type: 'phone-layout', layout: lastPhoneLayout });
  } else if (msg.type === 'phone-layout-apply' && msg.layout && source === 'bc') {
    // Scene imported in the controls window → push its mapping to the phone
    wsSend(msg);
  } else if (msg.type === 'set-slew-duration' && msg.duration !== undefined) {
    sceneSlewDuration = Math.max(0, parseFloat(msg.duration)) || 0;
  } else if (msg.type === 'set-slew-curve' && msg.curve) {
    if (SLEW_CURVES[msg.curve]) sceneSlewCurve = msg.curve;
  } else if (msg.type === 'set-fade-transitions') {
    sceneFadeTransitions = !!msg.enabled;
  } else if (msg.type === 'set-rec-filename') {
    setRecFilename(msg.filename);
  } else if (msg.type === 'camera-popup') {
    triggerCameraPopup();
  } else if (msg.type === 'fullscreen') {
    triggerFullscreen();
  } else if (msg.type === 'display-refresh') {
    // From this machine's controls window: also ask every other machine (the
    // master's server relays it to the slaves). From the relay: this one only.
    if (source === 'bc') wsSend({ type: 'display-refresh' });
    const report = { type: 'display-info', ...machine, ...refreshDisplay() };
    chan.postMessage(report);
    wsSend(report); // a slave's server forwards it up to the master
  } else if (msg.type === 'display-info' && source === 'ws') {
    // Another machine's report → this machine's controls window
    chan.postMessage(msg);
  }
}

// --- WebSocket connection to relay server (for phone controller) ---
function initWebSocket() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${proto}://${location.host}`;
  ws = new WebSocket(url);

  ws.onopen = () => {
    console.log('[ws] connected to relay');
    wsSend({ type: 'phone-layout-request' }); // phone may have connected first
    const phoneEl = document.getElementById('phone-conn');
    if (phoneEl) phoneEl.textContent = 'bridge active';
  };

  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      handleMessage(msg, 'ws');
    } catch (_) {}
  };

  ws.onclose = () => {
    console.log('[ws] disconnected, reconnecting in 2s...');
    const phoneEl = document.getElementById('phone-conn');
    if (phoneEl) phoneEl.textContent = 'disconnected';
    ws = null;
    setTimeout(initWebSocket, 2000);
  };

  ws.onerror = () => {
    ws.close();
  };
}

function wsSend(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

export function initChannel() {
  chan = new BroadcastChannel("flock-controls");

  chan.onmessage = (e) => {
    handleMessage(e.data || {}, 'bc');
  };

  // Start WebSocket bridge for phone controller
  initWebSocket();

  fetch('/api/role')
    .then(r => r.json())
    .then(r => { machine = { host: r.host || '', ip: r.ip || '', role: r.role || '' }; })
    .catch(() => {});
}

export function broadcastDevices(devices, currentDeviceId) {
  lastDeviceList = devices;
  lastCurrentDeviceId = currentDeviceId;
  if (chan) {
    chan.postMessage({ type: 'devices', devices, currentDeviceId });
  }
}
