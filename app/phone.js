// phone.js — phone touch controller UI logic
// Plain script (NOT an ES module) — loaded by phone.html

/* ═══════════════════════════════════════════════════════════
   CONFIGURATION
   ═══════════════════════════════════════════════════════════ */
// Caps for user-added controls (the layout starts blank). 8 sliders is the
// most that keep a usable column width on a portrait phone.
const MAX_SLIDERS = 8;
const MAX_TOGGLES = 12;
const MAX_SCENES = 6;
const LONG_PRESS_MS = 500;
const DRAG_SLOP = 6;      // px of travel before a press becomes a fader drag
const TOGGLE_COLS = 4;    // matches .toggles-zone grid-template-columns

const KP_NAMES = [
  'nose', 'L eye', 'R eye', 'L ear', 'R ear',
  'L shoulder', 'R shoulder', 'L elbow', 'R elbow',
  'L wrist', 'R wrist', 'L hip', 'R hip',
  'L knee', 'R knee', 'L ankle', 'R ankle',
];

const SKEL_COORDS = [
  {x:70,y:20},  {x:78,y:14},  {x:62,y:14},  {x:86,y:18},  {x:54,y:18},
  {x:92,y:56},  {x:48,y:56},  {x:106,y:92}, {x:34,y:92},
  {x:114,y:128},{x:26,y:128}, {x:85,y:135}, {x:55,y:135},
  {x:88,y:185}, {x:52,y:185}, {x:90,y:235}, {x:50,y:235},
];

const SKEL_BONES = [
  [0,1],[0,2],[1,3],[2,4],
  [5,6],[5,7],[7,9],[6,8],[8,10],
  [5,11],[6,12],[11,12],
  [11,13],[13,15],[12,14],[14,16],
];

/* ═══════════════════════════════════════════════════════════
   PARAMETER DEFINITIONS
   ═══════════════════════════════════════════════════════════ */

// Range parameters (for sliders)
const PARAM_GROUPS = [
  {
    title: "Population",
    params: [
      { key: "boidCount",       label: "Boid Count",    min: 1,    max: 5000, step: 1,    fmt: v => Math.round(v) },
      { key: "maxNeighbours",   label: "Max Neighbours",min: 5,    max: 200,   step: 1,    fmt: v => Math.round(v) },
      { key: "globalMaxSpeed",  label: "Max Speed",     min: 0.5,  max: 20,    step: 0.1,  fmt: v => v.toFixed(2) },
      { key: "globalForceMult", label: "Force Mult",    min: 0.1,  max: 10,     step: 0.01, fmt: v => v.toFixed(2) },
    ]
  },
  {
    title: "Boid-Boid Radii",
    params: [
      { key: "separationRadius", label: "Sep Radius",  min: 0, max: 5, step: 0.05, fmt: v => v.toFixed(2) },
      { key: "alignmentRadius",  label: "Aln Radius",  min: 0, max: 5, step: 0.05, fmt: v => v.toFixed(2) },
      { key: "cohesionRadius",   label: "Coh Radius",  min: 0, max: 5, step: 0.05, fmt: v => v.toFixed(2) },
    ]
  },
  {
    title: "Boid-Boid Weights",
    params: [
      { key: "separationWeight", label: "Sep Weight",  min: -6, max: 6, step: 0.1, fmt: v => v.toFixed(1) },
      { key: "alignmentWeight",  label: "Aln Weight",  min: -6, max: 6, step: 0.1, fmt: v => v.toFixed(1) },
      { key: "cohesionWeight",   label: "Coh Weight",  min: -6, max: 6, step: 0.1, fmt: v => v.toFixed(1) },
    ]
  },
  {
    title: "Boid-Body Radii",
    params: [
      { key: "bodySeparationRadius", label: "Body Sep R", min: 0, max: 5, step: 0.05, fmt: v => v.toFixed(2) },
      { key: "bodyAlignmentRadius",  label: "Body Aln R", min: 0, max: 5, step: 0.05, fmt: v => v.toFixed(2) },
      { key: "bodyCohesionRadius",   label: "Body Coh R", min: 0, max: 5, step: 0.05, fmt: v => v.toFixed(2) },
    ]
  },
  {
    title: "Boid-Body Weights",
    params: [
      { key: "bodySeparationWeight", label: "Body Sep W", min: -6, max: 6, step: 0.1, fmt: v => v.toFixed(1) },
      { key: "bodyAlignmentWeight",  label: "Body Aln W", min: -6, max: 6, step: 0.1, fmt: v => v.toFixed(1) },
      { key: "bodyCohesionWeight",   label: "Body Coh W", min: -6, max: 6, step: 0.1, fmt: v => v.toFixed(1) },
    ]
  },
  {
    title: "Appearance",
    params: [
      { key: "triangleSize", label: "Boid Size",   min: 0,   max: 100,  step: 0.1,  fmt: v => v.toFixed(1) },
      { key: "boidAlpha",    label: "Boid Alpha",  min: 0,   max: 1,   step: 0.01, fmt: v => v.toFixed(2) },
      { key: "boidRadiusOffset", label: "Size Offset", min: -20, max: 60, step: 0.5, fmt: v => v.toFixed(1) },
      { key: "gridCellSize", label: "Grid Cell",   min: 1,  max: 200, step: 1,    fmt: v => Math.round(v) },
    ]
  },
  {
    title: "Pose Detection",
    params: [
      { key: "minPoseScore",          label: "Pose Score",   min: 0.05, max: 0.8, step: 0.05, fmt: v => v.toFixed(2) },
      { key: "multiPoseMaxDimension", label: "Input Res",    min: 128,  max: 512, step: 32,   fmt: v => Math.round(v) },
      { key: "kpConfidence",          label: "KP Conf",      min: 0.01, max: 0.9, step: 0.01, fmt: v => v.toFixed(2) },
      { key: "kpSmoothing",           label: "KP Smooth",    min: 0.05, max: 1.0, step: 0.05, fmt: v => v.toFixed(2) },
    ]
  },
];

const PARAM_BY_KEY = {};
for (const g of PARAM_GROUPS) {
  for (const p of g.params) PARAM_BY_KEY[p.key] = p;
}

// Boolean parameters (for toggles + buttons)
const BOOL_GROUPS = [
  {
    title: "Webcam",
    params: [
      { key: "showVideo",    label: "Show Video" },
      { key: "webcamFill",   label: "Webcam Fill" },
      { key: "webcamMirror", label: "Webcam Mirror" },
    ]
  },
  {
    title: "Visual Toggles",
    params: [
      { key: "showSeparationRadius", label: "Sep Radius" },
      { key: "showAlignmentRadius",  label: "Aln Radius" },
      { key: "showCohesionRadius",   label: "Coh Radius" },
      { key: "showPath",             label: "Path Trail" },
      { key: "showCenterOfMassLine", label: "COM Line" },
      { key: "showTriangle",         label: "Boid" },
    ]
  },
  {
    title: "Visualizations",
    params: [
      { key: "showDensityHeatmap",    label: "Density Map" },
      { key: "showSpeedHeatmap",      label: "Speed Map" },
      { key: "showVelocityFlowField", label: "Flow Field" },
      { key: "showMoodColoring",      label: "Mood Color" },
    ]
  },
  {
    title: "Debug",
    params: [
      { key: "showSkeleton",           label: "Skeleton" },
      { key: "showActiveKeypoints",    label: "Keypoints" },
      { key: "showPerformanceOverlay", label: "Perf Overlay" },
    ]
  },
  {
    title: "Recording",
    params: [
      { key: "recordingMode", label: "Rec Mode" },
    ]
  },
  {
    title: "Actions",
    params: [
      { key: "_cameraPopup", label: "Camera Pop" },
      { key: "_fullscreen",  label: "Fullscreen" },
    ]
  },
];

const BOOL_BY_KEY = {};
for (const g of BOOL_GROUPS) {
  for (const p of g.params) BOOL_BY_KEY[p.key] = p;
}

/* ═══════════════════════════════════════════════════════════
   STATE
   ═══════════════════════════════════════════════════════════ */
let ws = null;
let state = {};

// The controller starts blank. A slot exists only once the operator has
// added it and picked its parameter, so these arrays never hold empty entries.
const sliderSlots = []; // { key, customMin, customMax }
let sliderDOM = [];

const toggleSlots = []; // { key }
let toggleDOM = [];

let assigningType = '';
let assigningIndex = -1; // === slots.length while adding a new control

let phoneMode = 'normal'; // 'normal' or 'skeleton'
let skelCircles = [];      // SVG circle elements for each keypoint
let skelSliderWrap = null;  // right-side slider container in skeleton mode

/* ═══════════════════════════════════════════════════════════
   WEBSOCKET
   ═══════════════════════════════════════════════════════════ */
const dotEl = document.getElementById('dot');
const statusText = document.getElementById('status-text');

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = () => {
    dotEl.className = 'dot ok';
    statusText.textContent = 'connected';
    ws.send(JSON.stringify({ type: 'sync' }));
    ws.send(JSON.stringify({ type: 'scene-list-request' }));
    publishPhoneLayout();
  };
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'state' || msg.type === 'snapshot') {
        state = msg.state;
        syncAllFromState();
      } else if (msg.type === 'scene-list') {
        handleSceneList(msg);
      } else if (msg.type === 'phone-layout-request') {
        publishPhoneLayout();
      } else if (msg.type === 'phone-layout-apply') {
        applyPhoneLayoutFromScene(msg.layout);
      }
    } catch (_) {}
  };
  ws.onclose = () => {
    dotEl.className = 'dot off';
    statusText.textContent = 'reconnecting...';
    ws = null;
    setTimeout(connect, 2000);
  };
  ws.onerror = () => ws.close();
}

function sendMsg(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function send(key, value) {
  sendMsg({ type: 'set', key, value });
}

/* ═══════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════ */
function getSliderRange(slotIndex) {
  const slot = sliderSlots[slotIndex];
  const param = PARAM_BY_KEY[slot.key];
  if (!param) return { min: 0, max: 1, step: 0.01, fmt: v => v };
  const min = slot.customMin !== null ? slot.customMin : param.min;
  const max = slot.customMax !== null ? slot.customMax : param.max;
  return { min, max, step: param.step, fmt: param.fmt };
}

function getSlotArray(type) {
  return type === 'slider' ? sliderSlots : toggleSlots;
}

function getMaxSlots(type) {
  return type === 'slider' ? MAX_SLIDERS : MAX_TOGGLES;
}

// Sets the fader fill to a 0–1 position.
function setSliderPos(dom, norm) {
  dom.norm = Math.max(0, Math.min(1, norm));
  dom.fader.style.setProperty('--fill', (dom.norm * 100) + '%');
}

// Pulls slider i's fill + readout from the live state value.
function syncSlider(i) {
  const slot = sliderSlots[i];
  const dom = sliderDOM[i];
  if (!slot || !dom || dom.dragging) return; // never fight the finger
  const { min, max, fmt } = getSliderRange(i);
  const val = state[slot.key];
  if (val !== undefined) {
    setSliderPos(dom, (val - min) / (max - min));
    dom.value.textContent = fmt(val);
  } else {
    setSliderPos(dom, 0.5);
    dom.value.textContent = '—';
  }
  dom.value.classList.toggle('has-custom-range', slot.customMin !== null || slot.customMax !== null);
}

// Maps slider i's fader position to its parameter range and sends it.
function sendSliderValue(i) {
  const dom = sliderDOM[i];
  const key = sliderSlots[i].key;
  const { min, max, step, fmt } = getSliderRange(i);
  const raw = min + dom.norm * (max - min);
  const snapped = Math.round(raw / step) * step;
  const clamped = Math.max(min, Math.min(max, snapped));
  if (clamped === state[key]) return;
  state[key] = clamped;
  dom.value.textContent = fmt(clamped);
  send(key, clamped);
}

/* ═══════════════════════════════════════════════════════════
   RENDER CONTROLS
   Rebuilt from sliderSlots/toggleSlots on every structural change
   (add, remove, remap, map set switch). Value changes only touch
   the existing DOM via syncAllFromState().
   ═══════════════════════════════════════════════════════════ */
const controlsArea = document.getElementById('controls-area');

function renderControls() {
  controlsArea.innerHTML = '';
  sliderDOM = [];
  toggleDOM = [];

  // Slider zone: fixed height (CSS). Faders are width-capped, so the add
  // tile soaks up the leftover width and stays a big target.
  const sliders = document.createElement('div');
  sliders.className = 'sliders-zone';
  for (let i = 0; i < sliderSlots.length; i++) sliders.appendChild(buildSlider(i));
  if (sliderSlots.length < MAX_SLIDERS) {
    // Past 3 faders the leftover column is too narrow for the words
    sliders.appendChild(makeAddTile('slider', sliderSlots.length <= 3 ? 'Add slider' : ''));
  }
  controlsArea.appendChild(sliders);

  // Toggle zone: fixed-height rows; the add tile fills out the last row.
  const toggles = document.createElement('div');
  toggles.className = 'toggles-zone';
  for (let i = 0; i < toggleSlots.length; i++) toggles.appendChild(buildToggle(i));
  if (toggleSlots.length < MAX_TOGGLES) {
    const add = makeAddTile('toggle', 'Add toggle');
    add.style.gridColumn = `span ${TOGGLE_COLS - (toggleSlots.length % TOGGLE_COLS)}`;
    toggles.appendChild(add);
  }
  controlsArea.appendChild(toggles);

  if (sliderSlots.length || toggleSlots.length) {
    const hint = document.createElement('div');
    hint.className = 'controls-hint';
    hint.textContent = 'Long-press a control to remap or remove it';
    controlsArea.appendChild(hint);
  }
}

function makeAddTile(type, text) {
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'add-tile';
  tile.setAttribute('aria-label', type === 'slider' ? 'Add slider' : 'Add toggle');
  const plus = document.createElement('span');
  plus.className = 'add-plus';
  plus.textContent = '+';
  tile.appendChild(plus);
  if (text) {
    const lbl = document.createElement('span');
    lbl.textContent = text;
    tile.appendChild(lbl);
  }
  // Index one past the end = "new slot"; it is only created once a
  // parameter is picked, so cancelling the panel adds nothing.
  tile.addEventListener('click', () => openAssignPanel(type, getSlotArray(type).length));
  return tile;
}

/* ═══════════════════════════════════════════════════════════
   BUILD SLIDER
   ═══════════════════════════════════════════════════════════ */
function buildSlider(i) {
  const param = PARAM_BY_KEY[sliderSlots[i].key];

  const col = document.createElement('div');
  col.className = 'slider-col';

  const label = document.createElement('div');
  label.className = 'slider-label';
  label.textContent = param.label;

  const value = document.createElement('div');
  value.className = 'slider-value';

  const fader = document.createElement('div');
  fader.className = 'fader';
  fader.setAttribute('role', 'slider');
  fader.setAttribute('aria-label', param.label);
  const fill = document.createElement('div');
  fill.className = 'fader-fill';
  fader.appendChild(fill);

  col.appendChild(label);
  col.appendChild(value);
  col.appendChild(fader);

  const dom = { col, label, value, fader, norm: 0.5, dragging: false, didLong: false };
  sliderDOM[i] = dom;
  syncSlider(i);
  setupSliderGestures(i, dom);

  // Tap value to open min/max popover
  value.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!dom.didLong) openRangePopover(i, value);
  });

  return col;
}

// Vertical drag on the fader moves the value relative to where the finger
// landed (no jump on touch). Holding still anywhere on the column opens
// the remap panel.
function setupSliderGestures(i, dom) {
  let pointerId = null;
  let timer = null;
  let startY = 0;
  let startNorm = 0;
  let onFader = false;

  function end() {
    if (timer) { clearTimeout(timer); timer = null; }
    pointerId = null;
    dom.dragging = false;
    dom.fader.classList.remove('dragging');
  }

  dom.col.addEventListener('pointerdown', (e) => {
    if (pointerId !== null) return;
    pointerId = e.pointerId;
    startY = e.clientY;
    startNorm = dom.norm;
    dom.didLong = false;
    // Capture only for fader drags — capturing on the header would
    // retarget the value readout's click to the column.
    onFader = dom.fader.contains(e.target);
    if (onFader) dom.col.setPointerCapture(e.pointerId);
    timer = setTimeout(() => {
      dom.didLong = true;
      end();
      openAssignPanel('slider', i);
    }, LONG_PRESS_MS);
  });

  dom.col.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointerId) return;
    const dy = startY - e.clientY;
    if (!dom.dragging) {
      if (Math.abs(dy) < DRAG_SLOP) return;
      if (timer) { clearTimeout(timer); timer = null; }
      if (!onFader) return;
      dom.dragging = true;
      dom.fader.classList.add('dragging');
    }
    setSliderPos(dom, startNorm + dy / dom.fader.clientHeight);
    sendSliderValue(i);
  });

  dom.col.addEventListener('pointerup', (e) => { if (e.pointerId === pointerId) end(); });
  dom.col.addEventListener('pointercancel', (e) => { if (e.pointerId === pointerId) end(); });
}

/* ═══════════════════════════════════════════════════════════
   BUILD TOGGLE
   Long-press to remap, tap to toggle
   ═══════════════════════════════════════════════════════════ */
function buildToggle(i) {
  const key = toggleSlots[i].key;
  const param = BOOL_BY_KEY[key];

  const btn = document.createElement('div');
  btn.className = 'ctrl-btn toggle assigned';
  btn.classList.toggle('on', !!state[key]);
  const icon = document.createElement('div');
  icon.className = 'ctrl-icon';
  icon.textContent = key.startsWith('_') ? '⚡' : '●';
  const lbl = document.createElement('div');
  lbl.textContent = param.label;
  btn.appendChild(icon);
  btn.appendChild(lbl);

  toggleDOM[i] = { btn, icon, lbl };
  setupToggleBehaviour(btn, i);
  return btn;
}

function setupToggleBehaviour(btn, index) {
  let timer = null;
  let didLong = false;

  btn.addEventListener('touchstart', () => {
    didLong = false;
    timer = setTimeout(() => {
      didLong = true;
      openAssignPanel('toggle', index);
    }, LONG_PRESS_MS);
  }, { passive: true });

  btn.addEventListener('touchmove', () => {
    if (timer) { clearTimeout(timer); timer = null; }
  }, { passive: true });

  btn.addEventListener('touchend', () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (didLong) return;

    const slot = toggleSlots[index];

    // Action keys fire once on tap
    if (slot.key.startsWith('_')) {
      // Message TYPES, not `set` keys — channel.js dispatches on msg.type.
      // (Sent as { type: 'set', key: 'camera-popup' } these did nothing.)
      sendMsg({ type: slot.key === '_cameraPopup' ? 'camera-popup' : 'fullscreen' });
      return;
    }

    // Toggle
    const next = !state[slot.key];
    state[slot.key] = next;
    btn.classList.toggle('on', next);
    send(slot.key, next);
  });
}

/* ═══════════════════════════════════════════════════════════
   SYNC ALL FROM STATE
   ═══════════════════════════════════════════════════════════ */
function syncAllFromState() {
  // Normal mode sliders + toggles
  for (let i = 0; i < sliderSlots.length; i++) syncSlider(i);
  for (let i = 0; i < toggleSlots.length; i++) {
    toggleDOM[i].btn.classList.toggle('on', !!state[toggleSlots[i].key]);
  }
  // Skeleton mode: update circles + kp sliders
  if (phoneMode === 'skeleton') {
    // A joint switched on/off elsewhere (laptop, scene) changes which
    // faders exist — rebuild then; otherwise just move the fills.
    const activeKps = [];
    for (let i = 0; i < 17; i++) if (state[`kp${i}`]) activeKps.push(i);
    const shownKps = [...new Set(kpFaders.map(f => +f.key.match(/^kp(\d+)/)[1]))];
    if (activeKps.join() !== shownKps.join()) rebuildKpSliders();
    else syncKpSliders();
  }
}

/* ═══════════════════════════════════════════════════════════
   ADD / REMAP / REMOVE
   ═══════════════════════════════════════════════════════════ */
function assignControl(type, index, paramKey) {
  const slots = getSlotArray(type);

  if (index >= slots.length) {
    if (slots.length < getMaxSlots(type)) {
      slots.push(type === 'slider'
        ? { key: paramKey, customMin: null, customMax: null }
        : { key: paramKey });
    }
  } else {
    slots[index].key = paramKey;
    // A custom range belongs to the old parameter's units
    if (type === 'slider') {
      slots[index].customMin = null;
      slots[index].customMax = null;
    }
  }

  closeAssignPanel();
  renderControls();
  saveAssignments();
}

function removeControl(type, index) {
  getSlotArray(type).splice(index, 1);
  closeAssignPanel();
  renderControls();
  saveAssignments();
}

/* ═══════════════════════════════════════════════════════════
   RESTORE ASSIGNMENTS FROM SCENE (batch, no per-slot saves)
   ═══════════════════════════════════════════════════════════ */
function restoreAssignmentsFromScene(scene) {
  sliderSlots.length = 0;
  toggleSlots.length = 0;

  // Older saves stored fixed-length arrays with null holes; drop those.
  for (const s of scene.sliders || []) {
    if (sliderSlots.length >= MAX_SLIDERS) break;
    if (s && s.key && PARAM_BY_KEY[s.key]) {
      sliderSlots.push({ key: s.key, customMin: s.customMin ?? null, customMax: s.customMax ?? null });
    }
  }
  // `buttons` was the second toggle grid of the old fixed layout; fold it
  // in ahead of `toggles` to keep the old left-to-right order.
  for (const key of [...(scene.buttons || []), ...(scene.toggles || [])]) {
    if (toggleSlots.length >= MAX_TOGGLES) break;
    if (key && BOOL_BY_KEY[key] && !toggleSlots.some(t => t.key === key)) {
      toggleSlots.push({ key });
    }
  }

  renderControls();
}

/* ═══════════════════════════════════════════════════════════
   ASSIGNMENT PANEL
   ═══════════════════════════════════════════════════════════ */
const overlay = document.getElementById('assign-overlay');
const assignList = document.getElementById('assign-list');
const assignSearch = document.getElementById('assign-search');
const assignTitle = document.getElementById('assign-title');
const assignCloseBtn = document.getElementById('assign-close');

function openAssignPanel(type, index) {
  closeRangePopover(); // close any open popover first
  assigningType = type;
  assigningIndex = index;
  const isNew = index >= getSlotArray(type).length;
  const label = type === 'slider' ? 'Slider' : 'Toggle';
  assignTitle.textContent = isNew ? `Add ${label.toLowerCase()}` : `${label} ${index + 1}`;
  assignSearch.value = '';
  buildAssignList('');
  overlay.classList.add('open');
}

function closeAssignPanel() {
  overlay.classList.remove('open');
  assigningType = '';
  assigningIndex = -1;
}

function buildAssignList(filter) {
  assignList.innerHTML = '';
  const f = filter.toLowerCase();
  const isRange = assigningType === 'slider';
  const groups = isRange ? PARAM_GROUPS : BOOL_GROUPS;

  const slotsArr = getSlotArray(assigningType);
  const usedKeys = new Set();
  for (let i = 0; i < slotsArr.length; i++) {
    if (i !== assigningIndex) usedKeys.add(slotsArr[i].key);
  }

  if (slotsArr[assigningIndex]) {
    const removeItem = document.createElement('div');
    removeItem.className = 'assign-item assign-item-unassign';
    removeItem.textContent = isRange ? 'Remove slider' : 'Remove toggle';
    removeItem.addEventListener('click', () => removeControl(assigningType, assigningIndex));
    assignList.appendChild(removeItem);
  }

  for (const group of groups) {
    const matching = group.params.filter(p => {
      if (usedKeys.has(p.key)) return false;
      if (!f) return true;
      return p.label.toLowerCase().includes(f) || p.key.toLowerCase().includes(f);
    });
    if (matching.length === 0) continue;

    const title = document.createElement('div');
    title.className = 'assign-group-title';
    title.textContent = group.title;
    assignList.appendChild(title);

    for (const p of matching) {
      const item = document.createElement('div');
      item.className = 'assign-item';
      const lbl = document.createElement('span');
      lbl.className = 'param-label';
      lbl.textContent = p.label;
      const key = document.createElement('span');
      key.className = 'param-key';
      key.textContent = p.key;
      item.appendChild(lbl);
      item.appendChild(key);
      item.addEventListener('click', () => assignControl(assigningType, assigningIndex, p.key));
      assignList.appendChild(item);
    }
  }
}

assignSearch.addEventListener('input', () => buildAssignList(assignSearch.value));
assignCloseBtn.addEventListener('click', closeAssignPanel);
overlay.addEventListener('click', (e) => {
  if (e.target === overlay) closeAssignPanel();
});

/* ═══════════════════════════════════════════════════════════
   MIN/MAX RANGE POPOVER
   ═══════════════════════════════════════════════════════════ */
const popover = document.getElementById('range-popover');
const popMin = document.getElementById('pop-min');
const popMax = document.getElementById('pop-max');
const popReset = document.getElementById('pop-reset');
const popOk = document.getElementById('pop-ok');
let popoverSlot = -1;

function openRangePopover(slotIndex, anchor) {
  popoverSlot = slotIndex;
  const slot = sliderSlots[slotIndex];
  const param = PARAM_BY_KEY[slot.key];
  if (!param) return;

  popMin.value = slot.customMin !== null ? slot.customMin : param.min;
  popMax.value = slot.customMax !== null ? slot.customMax : param.max;
  popMin.step = param.step;
  popMax.step = param.step;

  const rect = anchor.getBoundingClientRect();
  popover.style.left = Math.max(4, Math.min(rect.left - 60, window.innerWidth - 190)) + 'px';
  popover.style.top = Math.min(rect.bottom + 4, window.innerHeight - 120) + 'px';

  popover.classList.add('open');
}

function closeRangePopover() {
  popover.classList.remove('open');
  popoverSlot = -1;
}

popOk.addEventListener('click', () => {
  if (popoverSlot < 0) return;
  const slot = sliderSlots[popoverSlot];

  const minVal = parseFloat(popMin.value);
  const maxVal = parseFloat(popMax.value);
  if (!isNaN(minVal) && !isNaN(maxVal) && minVal < maxVal) {
    slot.customMin = minVal;
    slot.customMax = maxVal;
  }

  syncSlider(popoverSlot);
  saveAssignments();
  closeRangePopover();
});

popReset.addEventListener('click', () => {
  if (popoverSlot < 0) return;
  const slot = sliderSlots[popoverSlot];
  slot.customMin = null;
  slot.customMax = null;

  syncSlider(popoverSlot);
  saveAssignments();
  closeRangePopover();
});

document.addEventListener('click', (e) => {
  if (popover.classList.contains('open') && !popover.contains(e.target)) {
    closeRangePopover();
  }
});

/* ═══════════════════════════════════════════════════════════
   SCENE SIDEBAR
   ═══════════════════════════════════════════════════════════ */
const sceneBar = document.getElementById('scene-bar');
const SCENE_LETTERS = 'ABCDEFGH';
let scenes = []; // array of { sliders, toggles }
let activeScene = -1;

function collectSceneData() {
  return {
    sliders: sliderSlots.map(s => ({ key: s.key, customMin: s.customMin, customMax: s.customMax })),
    toggles: toggleSlots.map(s => s.key),
  };
}

function recallScene(index) {
  const scene = scenes[index];
  if (!scene) return;

  activeScene = index;

  // Restore slot assignments (sliders/buttons/toggles) from scene
  // This only changes which parameters the controls point to —
  // it does NOT change any parameter values in the simulation.
  restoreAssignmentsFromScene(scene);

  // Update UI to reflect current live state for the newly mapped parameters
  syncAllFromState();
  renderSceneBar();
  saveAssignments(); // persists + publishes the active map set
}

function saveScene(index) {
  scenes[index] = collectSceneData();
  activeScene = index;
  saveAssignments();
  renderSceneBar();
}

function addScene() {
  if (scenes.length >= MAX_SCENES) return;
  scenes.push({ sliders: [], toggles: [] });
  recallScene(scenes.length - 1);
}

/* ── Genie scene navigation ───────────────────────────── */
let genieActive = false;
let genieStartX = 0;
let genieStartIndex = -1;
let genieCurrentIndex = -1;
let genieTimer = null;
let geniePills = [];

function getScenePillRects() {
  const pills = sceneBar.querySelectorAll('.scene-pill.filled');
  return Array.from(pills).map(p => {
    const r = p.getBoundingClientRect();
    return { el: p, centerX: r.left + r.width / 2 };
  });
}

function updateGenieHighlight(index) {
  if (genieCurrentIndex === index) return;
  genieCurrentIndex = index;
  for (let i = 0; i < geniePills.length; i++) {
    const pill = geniePills[i].el;
    pill.classList.remove('genie-active', 'genie-near');
    if (i === index) {
      pill.classList.add('genie-active');
    } else if (Math.abs(i - index) === 1) {
      pill.classList.add('genie-near');
    }
  }
}

function endGenie(doRecall) {
  if (genieTimer) { clearTimeout(genieTimer); genieTimer = null; }
  sceneBar.classList.remove('genie-mode');
  for (const { el } of geniePills) {
    el.classList.remove('genie-active', 'genie-near');
    el.style.transform = '';
    el.style.opacity = '';
  }
  if (doRecall && genieActive && genieCurrentIndex >= 0 && genieCurrentIndex < scenes.length) {
    recallScene(genieCurrentIndex);
  }
  genieActive = false;
  genieCurrentIndex = -1;
  geniePills = [];
}

function renderSceneBar() {
  sceneBar.innerHTML = '';

  for (let i = 0; i < scenes.length; i++) {
    const pill = document.createElement('div');
    pill.className = 'scene-pill filled';
    if (i === activeScene) pill.classList.add('active');
    pill.textContent = SCENE_LETTERS[i] || (i + 1);
    sceneBar.appendChild(pill);
  }

  // "+" button if not at capacity
  if (scenes.length < MAX_SCENES) {
    const add = document.createElement('div');
    add.className = 'scene-pill add';
    add.textContent = '+';
    add.addEventListener('click', addScene);
    sceneBar.appendChild(add);
  }

  // Attach genie touch handling to the whole scene bar
  setupSceneBarTouch();
}

// Track attached listeners so we can remove them on re-render
let sceneBarCleanup = null;

function setupSceneBarTouch() {
  // Remove previous listeners if any
  if (sceneBarCleanup) { sceneBarCleanup(); sceneBarCleanup = null; }

  function onTouchStart(e) {
    const pill = e.target.closest('.scene-pill.filled');
    if (!pill) return;
    const pills = Array.from(sceneBar.querySelectorAll('.scene-pill.filled'));
    const idx = pills.indexOf(pill);
    if (idx < 0) return;

    genieStartX = e.touches[0].clientX;
    genieStartIndex = idx;
    genieActive = false;

    genieTimer = setTimeout(() => {
      genieActive = true;
      geniePills = getScenePillRects();
      sceneBar.classList.add('genie-mode');
      updateGenieHighlight(idx);
    }, LONG_PRESS_MS);
  }

  function onTouchMove(e) {
    if (genieTimer && !genieActive) {
      const dx = Math.abs(e.touches[0].clientX - genieStartX);
      if (dx > 10) { clearTimeout(genieTimer); genieTimer = null; }
      return;
    }
    if (!genieActive) return;
    e.preventDefault();

    const touchX = e.touches[0].clientX;
    let closest = 0;
    let minDist = Infinity;
    for (let i = 0; i < geniePills.length; i++) {
      const dist = Math.abs(touchX - geniePills[i].centerX);
      if (dist < minDist) { minDist = dist; closest = i; }
    }
    updateGenieHighlight(closest);
  }

  function onTouchEnd() {
    if (genieActive) {
      endGenie(true);
      return;
    }
    if (genieTimer) {
      clearTimeout(genieTimer);
      genieTimer = null;
      if (genieStartIndex >= 0) recallScene(genieStartIndex);
    }
  }

  function onTouchCancel() {
    endGenie(false);
  }

  sceneBar.addEventListener('touchstart', onTouchStart, { passive: true });
  sceneBar.addEventListener('touchmove', onTouchMove, { passive: false });
  sceneBar.addEventListener('touchend', onTouchEnd);
  sceneBar.addEventListener('touchcancel', onTouchCancel);

  sceneBarCleanup = () => {
    sceneBar.removeEventListener('touchstart', onTouchStart);
    sceneBar.removeEventListener('touchmove', onTouchMove);
    sceneBar.removeEventListener('touchend', onTouchEnd);
    sceneBar.removeEventListener('touchcancel', onTouchCancel);
  };
}

/* ═══════════════════════════════════════════════════════════
   PERSISTENCE
   ═══════════════════════════════════════════════════════════ */
const STORAGE_KEY = 'phone-ctrl-v3';

// The whole phone setup: live slots + map sets. One shape for localStorage
// and for the `_phone` block of exported scenes.
function collectPhoneLayout() {
  return {
    ...collectSceneData(),
    scenes: scenes,
    activeScene: activeScene,
  };
}

function saveAssignments() {
  // Keep active scene in sync with current assignments + values
  if (activeScene >= 0 && scenes[activeScene]) {
    scenes[activeScene] = collectSceneData();
  }
  const data = collectPhoneLayout();
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (_) {}
  publishPhoneLayout();
}

// Tells the laptop the current setup, so a scene export carries it.
function publishPhoneLayout() {
  sendMsg({ type: 'phone-layout', layout: collectPhoneLayout() });
}

function applyPhoneLayout(data) {
  scenes = Array.isArray(data.scenes) ? data.scenes.slice(0, MAX_SCENES) : [];
  activeScene = Number.isInteger(data.activeScene) && scenes[data.activeScene] ? data.activeScene : -1;
  // The active map set overrides the top-level slots
  restoreAssignmentsFromScene(scenes[activeScene] || data);
}

function loadAssignments() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) applyPhoneLayout(JSON.parse(raw));
  } catch (_) {}
}

// A scene loaded on the laptop carried a `_phone` block: take it over.
function applyPhoneLayoutFromScene(layout) {
  if (!layout || typeof layout !== 'object') return;
  closeAssignPanel();
  closeRangePopover();
  applyPhoneLayout(layout);
  renderSceneBar();
  syncAllFromState();
  saveAssignments();
}

/* ═══════════════════════════════════════════════════════════
   FULLSCREEN
   ═══════════════════════════════════════════════════════════ */
const fsPrompt = document.getElementById('fs-prompt');
const fsLabel = document.getElementById('fs-label');
const fsSub = document.getElementById('fs-sub');
const fsIcon = document.getElementById('fs-icon');

const isStandalone = window.matchMedia('(display-mode: standalone)').matches
                  || window.matchMedia('(display-mode: fullscreen)').matches
                  || window.navigator.standalone === true;

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
           || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const canFullscreen = document.documentElement.requestFullscreen
                   || document.documentElement.webkitRequestFullscreen;

// Hard portrait lock. The Screen Orientation API only grants a lock while the
// page is fullscreen/installed, so this is called on every route into that
// state rather than once at load. iOS Safari does not implement lock() at all —
// there the manifest's "orientation": "portrait" is what holds it, and only
// once the app is added to the Home Screen.
function lockPortrait() {
  const o = screen.orientation;
  if (o && o.lock) o.lock('portrait').catch(() => {});
}

if (isStandalone) {
  fsPrompt.classList.add('hidden');
  lockPortrait();
} else if (isIOS) {
  fsIcon.innerHTML = '<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>';
  fsLabel.textContent = 'Add to Home Screen';
  fsSub.innerHTML = 'Tap <svg viewBox="0 0 24 24" style="width:16px;height:16px;vertical-align:middle;stroke:var(--accent);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg> in Safari, then <strong>Add to Home Screen</strong> to run without browser bars.';
  fsPrompt.addEventListener('click', () => fsPrompt.classList.add('hidden'));
} else if (canFullscreen) {
  fsPrompt.addEventListener('click', () => {
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req) {
      req.call(el).then(() => {
        fsPrompt.classList.add('hidden');
        lockPortrait();
      }).catch(() => fsPrompt.classList.add('hidden'));
    }
  });
  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) {
      fsPrompt.classList.add('hidden');
      lockPortrait();   // covers entering fullscreen by any route
    }
  });
} else {
  fsPrompt.classList.add('hidden');
}

/* ═══════════════════════════════════════════════════════════
   VIEWS — Controls ('normal') · Body ('skeleton') · Scenes
   ═══════════════════════════════════════════════════════════ */
const scenesView = document.getElementById('scenes-view');
const tabButtons = document.querySelectorAll('#tab-bar .tab');

function setPhoneMode(mode) {
  phoneMode = mode;
  for (const tab of tabButtons) tab.classList.toggle('active', tab.dataset.mode === mode);

  // Map sets only mean something for the Controls view
  sceneBar.style.display = mode === 'normal' ? '' : 'none';
  controlsArea.style.display = mode === 'normal' ? '' : 'none';
  scenesView.style.display = mode === 'scenes' ? '' : 'none';
  const skelContainer = document.getElementById('skeleton-mode');
  if (skelContainer && mode !== 'skeleton') skelContainer.style.display = 'none';

  if (mode === 'normal') {
    syncAllFromState();
  } else if (mode === 'skeleton') {
    showSkeletonMode();
  } else {
    sendMsg({ type: 'scene-list-request' });
    renderScenesView();
  }
}

for (const tab of tabButtons) {
  tab.addEventListener('click', () => setPhoneMode(tab.dataset.mode));
}

/* ═══════════════════════════════════════════════════════════
   SCENES VIEW
   Mirrors scenes.html on the laptop: it publishes `scene-list`
   ({ names, activeIndex, transitioning }, or { closed: true } when
   the window goes away) and takes `scene-activate` ({ index }).
   Both travel through the dumb relay; the phone never sees scene
   data, only names — scenes.html still sends load-scene itself.
   ═══════════════════════════════════════════════════════════ */
let sceneMgr = null; // last scene-list from scenes.html; null = not open

function handleSceneList(msg) {
  sceneMgr = msg.closed ? null : {
    names: Array.isArray(msg.names) ? msg.names : [],
    activeIndex: Number.isInteger(msg.activeIndex) ? msg.activeIndex : -1,
    transitioning: !!msg.transitioning,
  };
  renderScenesView();
}

function activateLaptopScene(index) {
  if (!sceneMgr || index < 0 || index >= sceneMgr.names.length) return;
  // Optimistic — scenes.html echoes the confirmed list right back
  sceneMgr.activeIndex = index;
  renderScenesView();
  sendMsg({ type: 'scene-activate', index });
}

function renderScenesView() {
  if (phoneMode !== 'scenes') return;
  scenesView.innerHTML = '';

  if (!sceneMgr) {
    scenesView.appendChild(makeScenesEmpty('Scene manager not open',
      'Open the scene manager on the laptop to browse its scenes here.'));
    return;
  }
  const { names, activeIndex, transitioning } = sceneMgr;
  if (names.length === 0) {
    scenesView.appendChild(makeScenesEmpty('No scenes loaded',
      'Load scene files into the scene manager on the laptop.'));
    return;
  }

  const head = document.createElement('div');
  head.className = 'scenes-head';
  const pos = document.createElement('span');
  pos.textContent = activeIndex >= 0
    ? `Scene ${activeIndex + 1} of ${names.length}`
    : `${names.length} scene${names.length > 1 ? 's' : ''} — none active`;
  head.appendChild(pos);
  if (transitioning) {
    const tr = document.createElement('span');
    tr.className = 'scenes-transition';
    tr.textContent = 'Transitioning';
    head.appendChild(tr);
  }
  scenesView.appendChild(head);

  const list = document.createElement('div');
  list.className = 'scenes-list';
  let activeRow = null;
  names.forEach((name, i) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'scene-row' + (i === activeIndex ? ' active' : '');
    const num = document.createElement('span');
    num.className = 'scene-row-num';
    num.textContent = i + 1;
    const lbl = document.createElement('span');
    lbl.className = 'scene-row-name';
    lbl.textContent = name;
    row.appendChild(num);
    row.appendChild(lbl);
    row.addEventListener('click', () => activateLaptopScene(i));
    list.appendChild(row);
    if (i === activeIndex) activeRow = row;
  });
  scenesView.appendChild(list);

  // Prev/Next sit at the bottom, under the thumb. With nothing active,
  // Next starts at scene 1 — same as the arrow keys in scenes.html.
  const nav = document.createElement('div');
  nav.className = 'scenes-nav';
  const prevIdx = activeIndex - 1;
  const nextIdx = activeIndex + 1;
  nav.appendChild(makeSceneNavButton('← Prev', names[prevIdx], prevIdx));
  nav.appendChild(makeSceneNavButton('Next →', names[nextIdx], nextIdx));
  scenesView.appendChild(nav);

  if (activeRow) activeRow.scrollIntoView({ block: 'nearest' });
}

function makeSceneNavButton(text, targetName, targetIndex) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.disabled = targetName === undefined;
  const main = document.createElement('span');
  main.textContent = text;
  btn.appendChild(main);
  const sub = document.createElement('span');
  sub.className = 'nav-sub';
  sub.textContent = targetName ?? ' ';
  btn.appendChild(sub);
  btn.addEventListener('click', () => activateLaptopScene(targetIndex));
  return btn;
}

function makeScenesEmpty(title, body) {
  const box = document.createElement('div');
  box.className = 'scenes-empty';
  const t = document.createElement('strong');
  t.textContent = title;
  const b = document.createElement('span');
  b.textContent = body;
  box.appendChild(t);
  box.appendChild(b);
  return box;
}

/* ═══════════════════════════════════════════════════════════
   SKELETON MODE (phone body keypoint toggle)
   ═══════════════════════════════════════════════════════════ */
// Keypoint weight/radius range — matches buildKpGroup() in controls.js
const KP_RANGE = { min: 0, max: 5, step: 0.1 };
// Tap tolerance around a joint, in skeleton viewBox units. The head joints
// sit ~8 units apart, so taps resolve to the nearest joint, not by overlap.
const KP_HIT_RADIUS = 22;

let kpFaders = []; // { key, el, valEl, norm, dragging } for the active joints

function showSkeletonMode() {
  let skelContainer = document.getElementById('skeleton-mode');
  if (!skelContainer) {
    skelContainer = document.createElement('div');
    skelContainer.id = 'skeleton-mode';
    skelContainer.className = 'skel-view';
    controlsArea.parentNode.insertBefore(skelContainer, controlsArea);
  }
  skelContainer.innerHTML = '';
  skelContainer.style.display = '';

  // Left: stick figure SVG
  const figWrap = document.createElement('div');
  figWrap.className = 'skel-figure';
  figWrap.appendChild(buildPhoneSkeletonSVG());
  skelContainer.appendChild(figWrap);

  // Right: scrollable weight/radius faders for enabled keypoints
  skelSliderWrap = document.createElement('div');
  skelSliderWrap.className = 'kp-panel';
  rebuildKpSliders();
  skelContainer.appendChild(skelSliderWrap);
}

function buildPhoneSkeletonSVG() {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  // Cropped to SKEL_COORDS' bounds (x 26–114, y 14–235) + joint radius +
  // stroke, so the figure fills the narrow panel instead of floating in it
  svg.setAttribute('viewBox', '16 4 108 241');
  svg.style.cssText = 'width:100%;height:100%;';

  // Draw bones
  for (const [a, b] of SKEL_BONES) {
    const line = document.createElementNS(svgNS, 'line');
    line.setAttribute('x1', SKEL_COORDS[a].x);
    line.setAttribute('y1', SKEL_COORDS[a].y);
    line.setAttribute('x2', SKEL_COORDS[b].x);
    line.setAttribute('y2', SKEL_COORDS[b].y);
    line.setAttribute('stroke', '#d1d1d6');
    line.setAttribute('stroke-width', '2');
    svg.appendChild(line);
  }

  // Draw keypoint circles (visual only — hit-testing is on the whole SVG)
  skelCircles = [];
  for (let i = 0; i < 17; i++) {
    const circle = document.createElementNS(svgNS, 'circle');
    circle.setAttribute('cx', SKEL_COORDS[i].x);
    circle.setAttribute('cy', SKEL_COORDS[i].y);
    circle.setAttribute('r', '7');
    circle.style.cssText = 'transition:fill 0.15s,stroke 0.15s;stroke-width:2;pointer-events:none;';
    svg.appendChild(circle);
    skelCircles.push(circle);
  }
  updateSkelCircleStyles();

  // A 7-unit dot is ~9px on screen — far too small to hit. Any tap on the
  // figure toggles the nearest joint within KP_HIT_RADIUS instead.
  svg.addEventListener('click', (e) => {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    let hit = -1;
    let best = KP_HIT_RADIUS;
    for (let i = 0; i < SKEL_COORDS.length; i++) {
      const d = Math.hypot(SKEL_COORDS[i].x - p.x, SKEL_COORDS[i].y - p.y);
      if (d < best) { best = d; hit = i; }
    }
    if (hit < 0) return;
    const key = `kp${hit}`;
    const next = !state[key];
    state[key] = next;
    send(key, next);
    rebuildKpSliders();
  });

  return svg;
}

function updateSkelCircleStyles() {
  for (let i = 0; i < skelCircles.length; i++) {
    const active = !!state[`kp${i}`];
    const c = skelCircles[i];
    if (active) {
      c.setAttribute('fill', '#007aff');
      c.setAttribute('stroke', '#007aff');
    } else {
      c.setAttribute('fill', 'transparent');
      c.setAttribute('stroke', '#d1d1d6');
    }
  }
}

function rebuildKpSliders() {
  if (!skelSliderWrap) return;
  skelSliderWrap.innerHTML = '';
  kpFaders = [];
  updateSkelCircleStyles();

  for (let i = 0; i < 17; i++) {
    if (!state[`kp${i}`]) continue;

    const header = document.createElement('div');
    header.className = 'kp-group-title';
    header.textContent = KP_NAMES[i];
    skelSliderWrap.appendChild(header);

    skelSliderWrap.appendChild(makeKpFader(i, 'Weight'));
    skelSliderWrap.appendChild(makeKpFader(i, 'Radius'));
  }

  if (kpFaders.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'kp-empty';
    hint.textContent = 'Tap joints on the figure to enable them';
    skelSliderWrap.appendChild(hint);
  }
}

// Horizontal fill fader: name on the left, value on the right, drawn over
// the fill. Same relative-drag rule as the Controls faders.
function makeKpFader(kpIndex, suffix) {
  const el = document.createElement('div');
  el.className = 'hfader';
  el.setAttribute('role', 'slider');
  el.setAttribute('aria-label', `${KP_NAMES[kpIndex]} ${suffix.toLowerCase()}`);
  const fill = document.createElement('div');
  fill.className = 'hfader-fill';
  const text = document.createElement('div');
  text.className = 'hfader-text';
  const name = document.createElement('span');
  name.textContent = suffix.toLowerCase();
  const valEl = document.createElement('span');
  valEl.className = 'hfader-value';
  text.appendChild(name);
  text.appendChild(valEl);
  el.appendChild(fill);
  el.appendChild(text);

  const f = { key: `kp${kpIndex}${suffix}`, el, valEl, norm: 0, dragging: false };
  kpFaders.push(f);
  syncKpFader(f);
  setupKpFaderDrag(f);
  return el;
}

function setKpFaderNorm(f, norm) {
  f.norm = Math.max(0, Math.min(1, norm));
  f.el.style.setProperty('--fill', (f.norm * 100) + '%');
}

function syncKpFader(f) {
  if (f.dragging) return;
  const v = state[f.key] !== undefined ? +state[f.key] : 1.0;
  setKpFaderNorm(f, (v - KP_RANGE.min) / (KP_RANGE.max - KP_RANGE.min));
  f.valEl.textContent = v.toFixed(1);
}

// Horizontal drags set the value; vertical ones are left to the panel's
// scroll (touch-action: pan-y), which cancels the pointer.
function setupKpFaderDrag(f) {
  let pointerId = null;
  let startX = 0;
  let startNorm = 0;

  function end() {
    pointerId = null;
    f.dragging = false;
    f.el.classList.remove('dragging');
  }

  f.el.addEventListener('pointerdown', (e) => {
    if (pointerId !== null) return;
    pointerId = e.pointerId;
    startX = e.clientX;
    startNorm = f.norm;
  });

  f.el.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointerId) return;
    const dx = e.clientX - startX;
    if (!f.dragging) {
      if (Math.abs(dx) < DRAG_SLOP) return;
      f.dragging = true;
      f.el.classList.add('dragging');
      f.el.setPointerCapture(pointerId);
    }
    setKpFaderNorm(f, startNorm + dx / f.el.clientWidth);
    const { min, max, step } = KP_RANGE;
    const snapped = Math.round((min + f.norm * (max - min)) / step) * step;
    const v = +Math.max(min, Math.min(max, snapped)).toFixed(1);
    if (v === state[f.key]) return;
    state[f.key] = v;
    f.valEl.textContent = v.toFixed(1);
    send(f.key, v);
  });

  f.el.addEventListener('pointerup', (e) => { if (e.pointerId === pointerId) end(); });
  f.el.addEventListener('pointercancel', (e) => { if (e.pointerId === pointerId) end(); });
}

function syncKpSliders() {
  for (const f of kpFaders) syncKpFader(f);
}

/* ═══════════════════════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════════════════════ */
renderControls();   // blank state until loadAssignments() finds a saved layout
loadAssignments();
renderSceneBar();
connect();
