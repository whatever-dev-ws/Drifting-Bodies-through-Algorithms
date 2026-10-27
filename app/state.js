// state.js — single source of truth for all simulation parameters

// ─── Boid-relative radii ─────────────────────────────────────────────
// All six radii are multiplication factors of the boid's base size, not
// pixels: effective radius = radiusFactor × boidBaseSize(state) × groupMult.
// The base is the ON-SCREEN sprite size, matching the point size in main.js,
// so at the default Boid Size of 1 (12px) a body radius of 4 reaches 48px,
// and growing the boids grows every interaction zone with them.
//
// It used to return the raw `triangleSize` slider value (1), which made the
// default body radius 4px — a wrist had to land on a boid for any body force
// to fire, so body forces never registered. Every consumer (worker, grid,
// radius overlays) goes through this function. The drawn sprite in main.js is
// this plus 2 × state.boidRadiusOffset — a visual-only offset that must NOT be
// added here.
export function boidBaseSize(state) {
  return Math.max(2, 12 * (state.triangleSize ?? 1));
}

export const state = {
  // Boid↔Boid weights
  separationWeight: 1.5,
  alignmentWeight:  1.0,
  cohesionWeight:   1.0,

  // Boid↔Boid radii — factors of boid size, see boidBaseSize()
  separationRadius: 2.5,
  alignmentRadius:  2.5,
  cohesionRadius:   2.5,

  // Visual toggles
  showSeparationRadius: false,
  showAlignmentRadius:  false,
  showCohesionRadius:   false,

  // Interaction radius overlay styling (renderer.js). Defaults reproduce the
  // original hardcoded cyan / green / yellow at 0.39 opacity.
  separationRadiusColor: '#00c8ff', separationRadiusAlpha: 0.39, separationRadiusWidth: 1,
  alignmentRadiusColor:  '#00ff00', alignmentRadiusAlpha:  0.39, alignmentRadiusWidth:  2,
  cohesionRadiusColor:   '#ffff00', cohesionRadiusAlpha:   0.39, cohesionRadiusWidth:   2,
  showPath:             false,
  showTriangle:         true,
  showCenterOfMassLine: false,
  showVideo:            false,

  triangleSize: 1,
  // Visual-only px added to the drawn boid RADIUS (main.js). Never enters
  // boidBaseSize(), so forces and interaction radii ignore it.
  boidRadiusOffset: 0,

  // Boid↔Body weights
  bodySeparationWeight: 1.0,
  bodyAlignmentWeight:  1.0,
  bodyCohesionWeight:   1.0,

  // Boid↔Body radii — factors of boid size, see boidBaseSize()
  bodySeparationRadius: 4.0,
  bodyAlignmentRadius:  4.0,
  bodyCohesionRadius:   4.0,

  // Global overrides
  globalMaxSpeed:  3.0,
  globalForceMult: 1.0,

  // Frame repulsion — inward push near the canvas edges (boid-worker.js)
  edgeMargin:   100,  // px from each edge where the push starts
  edgeStrength: 5,    // multiple of a boid's maxForce at the edge itself

  // ── Visualization styling ──────────────────────────────────────────
  // Density and speed encode MAGNITUDE, so each is a single-hue ramp
  // (opacity carries the magnitude) rather than the rainbow hue-sweep these
  // used to be. Two sequential ramps on screen at once → blue, then orange.
  densityColor: '#3987e5',
  densityAlpha: 0.35,
  speedColor:   '#eb6834',
  speedAlpha:   0.35,

  // Velocity flow field — direction arrows, one flat colour
  flowColor:      '#ffffff',
  flowAlpha:      0.6,
  flowLineWidth:  1.5,
  flowArrowScale: 0.4,   // arrow length as a fraction of cell size

  // Mood colouring — categorical, one colour per dominant force.
  // NOTE: 7 categories cannot be made colourblind-safe as scattered points
  // (validated: worst all-pairs ΔE far below floor at any ordering). Treated
  // as an expressive control, not an analytical encoding.
  moodSepColor:     '#e34948',
  moodAliColor:     '#199e70',
  moodCohColor:     '#4c9ae8',
  moodBodySepColor: '#d95926',
  moodBodyAliColor: '#1ae5e5',
  moodBodyCohColor: '#d55181',
  moodEdgeColor:    '#999999',

  // Group multipliers
  boidRadiiMult:   1.0,
  boidWeightsMult: 1.0,
  bodyRadiiMult:   1.0,
  bodyWeightsMult: 1.0,

  // Population
  boidCount: 100,
  maxNeighbours: 50,

  // Pose detection (model-level)
  minPoseScore: 0.15,          // MoveNet: min score to include a pose (lower = more people detected)
  multiPoseMaxDimension: 384,  // MoveNet: input resolution (higher = better for distant people, slower)
  // Pose detection (client-side)
  maxPoses: 6,                 // max people to track (1–6, keeps the N most confident)
  kpConfidence: 0.1,           // min keypoint score to use in flocking
  kpSmoothing: 0.5,

  // Webcam
  webcamFill: false,   // false = fit (letterbox), true = fill (crop)
  webcamMirror: false, // flip webcam horizontally (mirror mode)

  // Visualizations
  showDensityHeatmap: false,
  showSpeedHeatmap: false,
  showVelocityFlowField: false,
  gridCellSize: 60,
  showMoodColoring: false,

  // Keypoint toggles (MoveNet 17 keypoints)
  kp0: true,   // nose
  kp1: false,  // leftEye
  kp2: false,  // rightEye
  kp3: false,  // leftEar
  kp4: false,  // rightEar
  kp5: false,  // leftShoulder
  kp6: false,  // rightShoulder
  kp7: false,  // leftElbow
  kp8: false,  // rightElbow
  kp9: true,   // leftWrist
  kp10: true,  // rightWrist
  kp11: false, // leftHip
  kp12: false, // rightHip
  kp13: false, // leftKnee
  kp14: false, // rightKnee
  kp15: false, // leftAnkle
  kp16: false, // rightAnkle

  // Per-keypoint weight and radius multipliers
  kp0Weight: 1.0, kp0Radius: 1.0,
  kp1Weight: 1.0, kp1Radius: 1.0,
  kp2Weight: 1.0, kp2Radius: 1.0,
  kp3Weight: 1.0, kp3Radius: 1.0,
  kp4Weight: 1.0, kp4Radius: 1.0,
  kp5Weight: 1.0, kp5Radius: 1.0,
  kp6Weight: 1.0, kp6Radius: 1.0,
  kp7Weight: 1.0, kp7Radius: 1.0,
  kp8Weight: 1.0, kp8Radius: 1.0,
  kp9Weight: 1.0, kp9Radius: 1.0,
  kp10Weight: 1.0, kp10Radius: 1.0,
  kp11Weight: 1.0, kp11Radius: 1.0,
  kp12Weight: 1.0, kp12Radius: 1.0,
  kp13Weight: 1.0, kp13Radius: 1.0,
  kp14Weight: 1.0, kp14Radius: 1.0,
  kp15Weight: 1.0, kp15Radius: 1.0,
  kp16Weight: 1.0, kp16Radius: 1.0,

  // Debug
  showSkeleton: false,
  showActiveKeypoints: false,

  // Appearance
  canvasBgR: 0, canvasBgG: 0, canvasBgB: 0,
  boidR: 255, boidG: 255, boidB: 255, boidAlpha: 1.0,
  pathColor: '#ffffff',
  pathStrokeWidth: 1,
  pathAlpha: 0.4,
  comLineColor: '#ff0000',
  comLineWidth: 1.5,
  comLineAlpha: 0.47,
  skeletonColor: '#ffffff',
  skeletonAlpha: 0.5,
  keypointColor: '#ff6464',
  keypointAlpha: 1.0,

  // Performance overlay
  showPerformanceOverlay: true,

  // Recording mode: locks canvas to 1280×720
  recordingMode: false,
};

// Snapshot for BroadcastChannel
export function getState() {
  return { ...state };
}

// Key type sets for setKey coercion
const numKeys = new Set([
  'separationWeight', 'alignmentWeight', 'cohesionWeight',
  'separationRadius', 'alignmentRadius', 'cohesionRadius',
  'bodySeparationWeight', 'bodyAlignmentWeight', 'bodyCohesionWeight',
  'bodySeparationRadius', 'bodyAlignmentRadius', 'bodyCohesionRadius',
  'globalMaxSpeed', 'globalForceMult',
  'edgeMargin', 'edgeStrength',
  'boidRadiiMult', 'boidWeightsMult', 'bodyRadiiMult', 'bodyWeightsMult',
  'gridCellSize',
  'minPoseScore', 'kpConfidence', 'kpSmoothing',
  'canvasBgR', 'canvasBgG', 'canvasBgB',
  'boidR', 'boidG', 'boidB', 'boidAlpha', 'boidRadiusOffset',
  'pathStrokeWidth', 'pathAlpha', 'comLineWidth', 'comLineAlpha',
  'skeletonAlpha', 'keypointAlpha',
  'separationRadiusAlpha', 'alignmentRadiusAlpha', 'cohesionRadiusAlpha',
  'separationRadiusWidth', 'alignmentRadiusWidth', 'cohesionRadiusWidth',
  'densityAlpha', 'speedAlpha',
  'flowAlpha', 'flowLineWidth', 'flowArrowScale',
]);
const roundKeys = new Set(['boidCount', 'maxNeighbours', 'multiPoseMaxDimension', 'maxPoses']);
const boolKeys = new Set([
  'showSeparationRadius', 'showAlignmentRadius', 'showCohesionRadius',
  'showPath', 'showTriangle', 'showCenterOfMassLine', 'showVideo',
  'webcamFill', 'webcamMirror',
  'showDensityHeatmap', 'showSpeedHeatmap', 'showVelocityFlowField',
  'showMoodColoring',
  'showSkeleton', 'showActiveKeypoints', 'recordingMode',
  'showPerformanceOverlay',
]);

// Check if a key is boolean (used by channel.js for slew classification)
export function isBoolKey(key) {
  return boolKeys.has(key) || /^kp\d+$/.test(key);
}

// Check if a key is numeric (used by channel.js for slew classification)
export function isNumericKey(key) {
  return numKeys.has(key) || roundKeys.has(key)
    || key === 'triangleSize' || /^kp\d+(Weight|Radius)$/.test(key);
}

// ─── Effective-value clamps ──────────────────────────────────────────
// Free-entry number boxes accept values past a slider's range, and those
// reach the system untouched — except where the system itself has a ceiling
// it cannot pass. Such values are clamped HERE, in state, so that what every
// UI echoes back (controls box, phone, scene export) is the value actually
// in effect, never a typed number that silently does nothing.
//
// The ceilings:
//  • GPU point size. Boids are GL points; the GPU clamps gl_PointSize to
//    ALIASED_POINT_SIZE_RANGE (511px on Apple GPUs via ANGLE/Metal). main.js
//    reports it via setHardwareLimits() once the GL context exists.
//  • The 2px floor in boidBaseSize(): every Boid Size below 1/6 behaves
//    exactly like 1/6 (sprite AND interaction radii).
//  • Floors below which a value can't exist or would crash a consumer:
//    boidCount ≥ 0 (negative → RangeError in the worker every frame),
//    maxNeighbours ≥ 0 (negative behaves as 0), gridCellSize ≥ 1px (≤ 0
//    sizes the analytics grid to Infinity and throws inside draw(); a cell
//    smaller than a pixel draws nothing different anyway).
// Boid Size has no ceiling here: past ~42.6 the sprite stops growing, but the
// radii keep scaling with it, so the value is still in effect.
const hw = { maxPointSize: Infinity };
const MIN_TRIANGLE_SIZE = 2 / 12;

export function setHardwareLimits(limits) {
  Object.assign(hw, limits);
  clampToEffective();
}

// The drawn sprite is clamp(boidBaseSize + 2·offset, 1, maxPointSize) — see
// main.js. Outside [lo, hi] the offset no longer changes the drawing.
// hi never drops below 0: when Boid Size alone already maxes the sprite, an
// offset of 0 is left alone rather than forced negative — a negative offset
// would stick and shrink the boids once Boid Size comes back down.
export function radiusOffsetRange(s = state) {
  const base = boidBaseSize(s);
  return { lo: (1 - base) / 2, hi: Math.max(0, (hw.maxPointSize - base) / 2) };
}

function clampToEffective() {
  if (state.boidCount < 0) state.boidCount = 0;
  if (state.maxNeighbours < 0) state.maxNeighbours = 0;
  if (state.gridCellSize < 1) state.gridCellSize = 1;
  if (state.triangleSize < MIN_TRIANGLE_SIZE) state.triangleSize = MIN_TRIANGLE_SIZE;
  const { lo, hi } = radiusOffsetRange();
  if (state.boidRadiusOffset > hi) state.boidRadiusOffset = hi;
  else if (state.boidRadiusOffset < lo) state.boidRadiusOffset = lo;
}

// Mutate a single key with type coercion
export function setKey(key, value) {
  // Infinity/NaN can't cross JSON — the WebSocket relay and scene exports
  // would turn them into null (→ 0 on the phone and slaves). Refuse them;
  // the state echo then restores the box to the value still in effect.
  if (isNumericKey(key) && !Number.isFinite(+value)) return;
  setKeyRaw(key, value);
  clampToEffective(); // a handful of comparisons; Boid Size also moves the offset's limits
}

function setKeyRaw(key, value) {
  if (numKeys.has(key)) state[key] = +value;
  else if (roundKeys.has(key)) state[key] = Math.round(+value);
  else if (key === 'triangleSize') state.triangleSize = Math.max(0, parseFloat(value));
  else if (boolKeys.has(key)) {
    state[key] = !!value;
  }
  else if (/^kp\d+$/.test(key)) state[key] = (value === true || value === "true");
  else if (/^kp\d+(Weight|Radius)$/.test(key)) state[key] = parseFloat(value);
  else if (typeof value === 'string' && value.startsWith('#')) state[key] = value;
}
