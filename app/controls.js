// controls.js — builds UI and syncs with the main sketch via BroadcastChannel

// Slew speed for scene loading — seconds to reach target value.
// Change this constant to adjust transition speed (lower = faster).
const SCENE_SLEW_DURATION = 2.0; // seconds

const chan = new BroadcastChannel("flock-controls");
const statusEl = document.getElementById("status");
const syncBtn = document.getElementById("syncBtn");
const root = document.getElementById("controls");

// Declarative control list — each section has a `tab` property for grouping
const CONTROLS = [
  // ─── Camera tab ─────────────────────────────────────────────
  {
    title: "Source",
    tab: "settings",
    rows: [
      { label: "Camera Source", key: "cameraDeviceId", type: "select", options: [], tip: "Select which camera to use for body tracking." }
    ]
  },
  {
    title: "Webcam Display",
    tab: "settings",
    rows: [
      { label: "Show Video",   key: "showVideo",    type: "checkbox", tip: "Display the webcam feed behind the boids as a semi-transparent backdrop." },
      { label: "Fill Canvas",  key: "webcamFill",   type: "checkbox", tip: "Fill the entire canvas with the webcam (cropping edges) instead of fitting it with letterboxing." },
      { label: "Mirror",       key: "webcamMirror", type: "checkbox", tip: "Flip the webcam horizontally so it feels like looking in a mirror. Also mirrors body tracking coordinates." },
    ]
  },
  {
    // Former Debug tab — the overlay toggle was all that remained of it once
    // the skeleton/keypoint toggles moved to Appearance.
    title: "Debug",
    tab: "settings",
    rows: [
      { label: "Performance Overlay", key: "showPerformanceOverlay", type: "checkbox", tip: "Show the on-canvas boid and person counts." },
      // `local`: a preference of this controls window, not a simulation key —
      // never sent, never exported into scenes (see makeRowCheckbox).
      { label: "Tooltips", key: "showTooltips", type: "checkbox", local: true, tip: "Show the help text under controls in every tab. Saved in this browser only." },
      // A one-off command, not a key — see makeRowDisplayRefresh
      { label: "Re-detect Display", type: "display-refresh", tip: "Re-reads screen density and size. On the master it runs on every slave too. Use once all windows are on the projectors and full screen. Values in orange differ between machines or point to a setup problem (zoom not 100%, window not full screen)." },
    ]
  },
  // ─── Pose tab ───────────────────────────────────────────────
  {
    title: "Detection",
    tab: "settings",
    rows: [
      { label: "Min Pose Score", key: "minPoseScore",          type: "range", min: 0.05, max: 0.8, step: 0.05, fmt: v => (+v).toFixed(2), clamp: true, tip: "Minimum score for a detected person to be included. Lower = more people detected but noisier. Reinits detector on change." },
      { label: "Input Resolution", key: "multiPoseMaxDimension", type: "range", min: 128,  max: 512, step: 32,   fmt: v => v, clamp: true, tip: "Model input resolution. Higher = better detection of distant/small people but slower. Must be multiple of 32. Reinits detector on change." },
      { label: "Max Poses",      key: "maxPoses",               type: "range", min: 1,    max: 6,   step: 1,    fmt: v => v, clamp: true, tip: "Max people to track (1–6). Keeps the N most confident poses from each frame." },
      { label: "KP Confidence",  key: "kpConfidence",          type: "range", min: 0.01, max: 0.9, step: 0.01, fmt: v => (+v).toFixed(2), clamp: true, tip: "Minimum confidence for individual keypoints. Lower = more points but noisier." },
      { label: "KP Smoothing",   key: "kpSmoothing",           type: "range", min: 0.05, max: 1.0, step: 0.05, fmt: v => (+v).toFixed(2), clamp: true, tip: "Keypoint temporal smoothing. Lower = smoother but laggier, higher = more responsive but jittery." },
    ]
  },
  // Keypoints are no longer a flat list here — they live in the interactive
  // skeleton (see buildBodySVG). Selecting a keypoint reveals its weight/radius
  // controls in the detail panel beside the skeleton.
  // ─── Boids tab ──────────────────────────────────────────────
  {
    title: "Population",
    tab: "boids",
    rows: [
      // Boid size leads the section: every interaction radius is a factor of
      // it now (see boidBaseSize() in state.js), so it is a simulation
      // parameter, not a styling one.
      { label: "Boid Size",         key: "triangleSize",    type: "range", min: 0,  max: 100,    step: 0.1,  fmt: v => (+v).toFixed(1), tip: "Base size of each boid. All interaction radii are multiples of this, so changing it scales the whole flocking behaviour." },
      { label: "Boid Count",        key: "boidCount",       type: "range", min: 1,  max: 5000, step: 1,    fmt: v => v, tip: "Total number of boids in the simulation." },
      { label: "Max Neighbours",     key: "maxNeighbours",   type: "range", min: 5,   max: 200, step: 1,    fmt: v => v, tip: "Maximum neighbours each boid considers per frame." },
      { label: "Max Speed",          key: "globalMaxSpeed",  type: "range", min: 0.5, max: 20,  step: 0.1,  fmt: v => (+v).toFixed(2), tip: "Top speed per boid per frame." },
      { label: "Steering Limit",     key: "globalForceMult", type: "range", min: 0.1, max: 5,   step: 0.01, fmt: v => (+v).toFixed(2), tip: "Caps how hard boids can turn. Higher = snappier, lower = smoother." },
    ]
  },
  {
    title: "Frame Repulsion",
    tab: "boids",
    rows: [
      { label: "Margin",   key: "edgeMargin",   type: "range", min: 0, max: 500, step: 5,   fmt: v => (+v).toFixed(0) + " px", tip: "How far in from each canvas edge the inward push starts. Boids feel nothing outside this band. 0 disables the repulsion — boids will drift off-canvas." },
      { label: "Strength", key: "edgeStrength", type: "range", min: 0, max: 20,  step: 0.1, fmt: v => (+v).toFixed(1) + "×", tip: "Push at the edge itself, as a multiple of a boid's steering force. Ramps linearly from 0 at the margin line. 0 disables the repulsion." },
    ]
  },
  // The four interaction sections below are hidden from the Boids tab \u2014 the
  // live model diagram ("Controls" section) replaces them. They stay declared
  // so the Randomizer tab still offers their parameters.
  {
    title: "Boid \u2194 Boid Radii",
    tab: "boids",
    hidden: true,
    rows: [
      { label: "\u2605 All Radii",   key: "boidRadiiMult",    type: "range", min: 0, max: 5, step: 0.01, fmt: v => (+v).toFixed(2) + "\u00d7", tip: "Master multiplier \u2014 scales all three boid-to-boid radii at once." },
      { label: "Separation",         key: "separationRadius", type: "range", min: 0, max: 5, step: 0.05, fmt: v => (+v).toFixed(2) + "\u00d7" },
      { label: "Cohesion",           key: "cohesionRadius",   type: "range", min: 0, max: 5, step: 0.05, fmt: v => (+v).toFixed(2) + "\u00d7" },
      { label: "Alignment",          key: "alignmentRadius",  type: "range", min: 0, max: 5, step: 0.05, fmt: v => (+v).toFixed(2) + "\u00d7" },
    ]
  },
  {
    title: "Boid \u2194 Boid Weights",
    tab: "boids",
    hidden: true,
    rows: [
      { label: "\u2605 All Weights",  key: "boidWeightsMult",  type: "range", min: 0, max: 5, step: 0.01, fmt: v => (+v).toFixed(2) + "\u00d7", tip: "Master multiplier \u2014 scales all three boid-to-boid force strengths at once." },
      { label: "Separation",          key: "separationWeight", type: "range", min: -6, max: 6, step: 0.1, fmt: v => (+v).toFixed(1) },
      { label: "Cohesion",            key: "cohesionWeight",   type: "range", min: -6, max: 6, step: 0.1, fmt: v => (+v).toFixed(1) },
      { label: "Alignment",           key: "alignmentWeight",  type: "range", min: -6, max: 6, step: 0.1, fmt: v => (+v).toFixed(1) },
    ]
  },
  {
    title: "Boid \u2194 Body Radii",
    tab: "boids",
    hidden: true,
    rows: [
      { label: "\u2605 All Radii",    key: "bodyRadiiMult",          type: "range", min: 0, max: 5, step: 0.01, fmt: v => (+v).toFixed(2) + "\u00d7", tip: "Master multiplier \u2014 scales all three body interaction radii at once." },
      { label: "Separation",           key: "bodySeparationRadius", type: "range", min: 0, max: 5, step: 0.05, fmt: v => (+v).toFixed(2) + "\u00d7" },
      { label: "Cohesion",             key: "bodyCohesionRadius",   type: "range", min: 0, max: 5, step: 0.05, fmt: v => (+v).toFixed(2) + "\u00d7" },
      { label: "Alignment",            key: "bodyAlignmentRadius",  type: "range", min: 0, max: 5, step: 0.05, fmt: v => (+v).toFixed(2) + "\u00d7" },
    ]
  },
  {
    title: "Boid \u2194 Body Weights",
    tab: "boids",
    hidden: true,
    rows: [
      { label: "\u2605 All Weights",   key: "bodyWeightsMult",        type: "range", min: 0, max: 5, step: 0.01, fmt: v => (+v).toFixed(2) + "\u00d7", tip: "Master multiplier \u2014 scales all three body force strengths at once." },
      { label: "Separation",            key: "bodySeparationWeight", type: "range", min: -6, max: 6, step: 0.1, fmt: v => (+v).toFixed(1) },
      { label: "Cohesion",              key: "bodyCohesionWeight",   type: "range", min: -6, max: 6, step: 0.1, fmt: v => (+v).toFixed(1) },
      { label: "Alignment",             key: "bodyAlignmentWeight",  type: "range", min: -6, max: 6, step: 0.1, fmt: v => (+v).toFixed(1) },
    ]
  },
  // ─── Appearance tab ─────────────────────────────────────────
  // Merges the old Style and Visual tabs. Sections are grouped by SUBJECT,
  // not by control type — each thing that can be drawn owns its visibility
  // toggle and its styling in one place. Sections are then ordered into
  // families by semantic closeness; `group` renders a family header above
  // the first section of each run (see the build loop).
  {
    title: "Boids",
    tab: "appearance",
    group: "Boids & Canvas",
    enableKey: "showTriangle",
    rows: [
      { label: "Color",        key: "boidColor",    type: "color", rgbKeys: ["boidR", "boidG", "boidB"] },
      { label: "Opacity",      key: "boidAlpha",    type: "range", min: 0, max: 1, step: 0.01, fmt: v => (+v).toFixed(2) },
      { label: "Size Offset",  key: "boidRadiusOffset", type: "range", min: -20, max: 60, step: 0.5, fmt: v => ((+v > 0 ? "+" : "") + (+v).toFixed(1) + " px"), tip: "Visual only — adds to the drawn boid radius. Forces and interaction radii still use Boid Size (Boids tab), so this changes how boids look, not how they behave. Capped by the GPU's largest point size (511px on Apple GPUs): a larger value is replaced by the cap, so the box always shows the size actually drawn." },
      // Mood colouring lives inside Boids: it only renders through the boid
      // draw call (main.js gates it on showTriangle), so it collapses with it.
      // Its seven swatches are `tile` rows, packed side by side in a grid.
      { label: "Mood coloring", key: "showMoodColoring", type: "checkbox", tip: "Colours each boid by its strongest force this frame. Replaces the single boid colour above while on." },
      { label: "Separation",    key: "moodSepColor",      type: "color", parent: "showMoodColoring", tile: true },
      { label: "Alignment",     key: "moodAliColor",      type: "color", parent: "showMoodColoring", tile: true },
      { label: "Cohesion",      key: "moodCohColor",      type: "color", parent: "showMoodColoring", tile: true },
      { label: "Body Sep",      key: "moodBodySepColor",  type: "color", parent: "showMoodColoring", tile: true },
      { label: "Body Align",    key: "moodBodyAliColor",  type: "color", parent: "showMoodColoring", tile: true },
      { label: "Body Cohesion", key: "moodBodyCohColor",  type: "color", parent: "showMoodColoring", tile: true },
      { label: "Frame Edge",    key: "moodEdgeColor",     type: "color", parent: "showMoodColoring", tile: true },
    ]
  },
  {
    title: "Canvas",
    tab: "appearance",
    group: "Boids & Canvas",
    rows: [
      { label: "Background", key: "canvasBgColor", type: "color", rgbKeys: ["canvasBgR", "canvasBgG", "canvasBgB"] },
    ]
  },
  {
    title: "Skeleton",
    tab: "appearance",
    group: "Body",
    enableKey: "showSkeleton",
    rows: [
      { label: "Color",         key: "skeletonColor",  type: "color" },
      { label: "Opacity",       key: "skeletonAlpha",  type: "range", min: 0, max: 1, step: 0.01, fmt: v => (+v).toFixed(2) },
    ]
  },
  {
    title: "Keypoints",
    tab: "appearance",
    group: "Body",
    enableKey: "showActiveKeypoints",
    rows: [
      { label: "Color",          key: "keypointColor",       type: "color" },
      { label: "Opacity",        key: "keypointAlpha",       type: "range", min: 0, max: 1, step: 0.01, fmt: v => (+v).toFixed(2) },
    ]
  },
  {
    title: "Interaction Radii",
    tab: "appearance",
    group: "Behaviour",
    // Each toggle reveals its own Color / Opacity / Width sub-rows — same
    // trio as Path Trail and Center of Mass.
    rows: [
      { label: "Separation radius", key: "showSeparationRadius", type: "checkbox" },
      { label: "Color",   key: "separationRadiusColor", type: "color", parent: "showSeparationRadius" },
      { label: "Opacity", key: "separationRadiusAlpha", type: "range", min: 0, max: 1, step: 0.01, fmt: v => (+v).toFixed(2), parent: "showSeparationRadius" },
      { label: "Width",   key: "separationRadiusWidth", type: "range", min: 0.5, max: 100, step: 0.5, parent: "showSeparationRadius" },
      { label: "Alignment radius",  key: "showAlignmentRadius",  type: "checkbox" },
      { label: "Color",   key: "alignmentRadiusColor",  type: "color", parent: "showAlignmentRadius" },
      { label: "Opacity", key: "alignmentRadiusAlpha",  type: "range", min: 0, max: 1, step: 0.01, fmt: v => (+v).toFixed(2), parent: "showAlignmentRadius" },
      { label: "Width",   key: "alignmentRadiusWidth",  type: "range", min: 0.5, max: 100, step: 0.5, parent: "showAlignmentRadius" },
      { label: "Cohesion radius",   key: "showCohesionRadius",   type: "checkbox" },
      { label: "Color",   key: "cohesionRadiusColor",   type: "color", parent: "showCohesionRadius" },
      { label: "Opacity", key: "cohesionRadiusAlpha",   type: "range", min: 0, max: 1, step: 0.01, fmt: v => (+v).toFixed(2), parent: "showCohesionRadius" },
      { label: "Width",   key: "cohesionRadiusWidth",   type: "range", min: 0.5, max: 100, step: 0.5, parent: "showCohesionRadius" },
    ]
  },
  {
    title: "Center of Mass",
    tab: "appearance",
    group: "Behaviour",
    enableKey: "showCenterOfMassLine",
    rows: [
      { label: "Color",         key: "comLineColor",         type: "color" },
      { label: "Opacity",       key: "comLineAlpha",         type: "range", min: 0, max: 1, step: 0.01, fmt: v => (+v).toFixed(2) },
      { label: "Width",         key: "comLineWidth",         type: "range", min: 0.5, max: 100, step: 0.1 },
    ]
  },
  {
    title: "Path Trail",
    tab: "appearance",
    group: "Behaviour",
    enableKey: "showPath",
    rows: [
      { label: "Color",     key: "pathColor",        type: "color" },
      { label: "Opacity",   key: "pathAlpha",        type: "range", min: 0, max: 1, step: 0.01, fmt: v => (+v).toFixed(2) },
      { label: "Width",     key: "pathStrokeWidth",  type: "range", min: 0.5, max: 100, step: 0.5 },
    ]
  },
  {
    title: "Analysis Grid",
    tab: "appearance",
    group: "Field Analysis",
    rows: [
      { label: "Grid Cell Size", key: "gridCellSize", type: "range", min: 3, max: 200, step: 5, fmt: v => v, tip: "Cell size shared by both heatmaps and the flow field." },
    ]
  },
  {
    title: "Density Heatmap",
    tab: "appearance",
    group: "Field Analysis",
    enableKey: "showDensityHeatmap",
    rows: [
      { label: "Color",        key: "densityColor",       type: "color", tip: "Single hue — cell opacity carries the magnitude, so density reads as one ordered ramp." },
      { label: "Opacity",      key: "densityAlpha",       type: "range", min: 0, max: 1, step: 0.01, fmt: v => (+v).toFixed(2), tip: "Opacity of the densest cell. Emptier cells scale down from here." },
    ]
  },
  {
    title: "Speed Heatmap",
    tab: "appearance",
    group: "Field Analysis",
    enableKey: "showSpeedHeatmap",
    rows: [
      { label: "Color",      key: "speedColor",       type: "color", tip: "Single hue — cell opacity carries the magnitude." },
      { label: "Opacity",    key: "speedAlpha",       type: "range", min: 0, max: 1, step: 0.01, fmt: v => (+v).toFixed(2), tip: "Opacity of the fastest cell." },
    ]
  },
  {
    title: "Velocity Flow",
    tab: "appearance",
    group: "Field Analysis",
    enableKey: "showVelocityFlowField",
    rows: [
      { label: "Color",       key: "flowColor",             type: "color" },
      { label: "Opacity",     key: "flowAlpha",             type: "range", min: 0, max: 1, step: 0.01, fmt: v => (+v).toFixed(2) },
      { label: "Line Width",  key: "flowLineWidth",         type: "range", min: 0.5, max: 100, step: 0.5, fmt: v => (+v).toFixed(1) },
      { label: "Arrow Length",key: "flowArrowScale",        type: "range", min: 0.1, max: 1, step: 0.05, fmt: v => (+v).toFixed(2) + "×", tip: "Arrow length as a fraction of the grid cell size." },
    ]
  },
];

// Build UI
const inputsByKey = new Map();
const wrappersByKey = new Map();   // key → DOM wrapper (for parent-based show/hide)
const childKeysOf = new Map();     // parent key → [child keys]

function makeSection(title) {
  const section = document.createElement("div");
  section.className = "section";
  const h = document.createElement("h3");
  h.textContent = title;
  section.appendChild(h);
  return section;
}

// Section whose on/off control lives in the header rather than as the first
// row. Turning it off collapses the body — the styling below is meaningless
// when the thing it styles isn't drawn. Rows are appended to `_body`.
function makeSectionWithEnable(title, key) {
  const section = makeSection(title);
  const h = section.firstElementChild;
  h.style.display = "flex";
  h.style.alignItems = "center";
  h.style.justifyContent = "space-between";
  h.style.gap = "8px";

  const body = document.createElement("div");
  section.appendChild(body);
  section._body = body;

  const lab = document.createElement("label");
  // h3 is uppercase + letter-spaced; reset so the control reads as a control
  lab.style.cssText = "display:flex;align-items:center;gap:5px;cursor:pointer;"
    + "font-size:10px;color:var(--text-tertiary);text-transform:none;letter-spacing:normal;";
  // Stays a real <input type=checkbox> — the CSS paints it as a switch. The
  // type matters: collectCurrentState() and the scene import path both branch
  // on input.type === "checkbox".
  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "switch";
  input.dataset.key = key;
  input.setAttribute("role", "switch");
  // Bare switch, no visible text — the section title names it, and the
  // aria-label carries that title for screen readers.
  input.setAttribute("aria-label", title);
  lab.appendChild(input);
  h.appendChild(lab);

  const apply = (on) => {
    body.style.display = on ? "" : "none";
    input.setAttribute("aria-checked", on ? "true" : "false");
  };
  input.addEventListener("change", () => {
    apply(input.checked);
    sendSet(key, input.checked);
  });
  apply(input.checked);

  inputsByKey.set(key, { input, setValue: (v) => {
    input.checked = !!v;
    apply(input.checked);
  }});

  return section;
}

// ─── Local UI preferences ──────────────────────────────────────
// Per-browser settings of the controls window itself (checkbox rows with
// `local: true`). Each has a default and an apply() that reflects it in the
// page. Storage can be unavailable (private window, blocked site data), so
// every access is guarded and the default wins.
const LOCAL_PREFS_KEY = "flock-controls-prefs";
const LOCAL_PREFS = {
  showTooltips: {
    default: true,
    apply: (on) => document.body.classList.toggle("hide-tips", !on),
  },
};
function readLocalPrefs() {
  try { return JSON.parse(localStorage.getItem(LOCAL_PREFS_KEY)) || {}; } catch { return {}; }
}
function getLocalPref(key) {
  const v = readLocalPrefs()[key];
  return typeof v === "boolean" ? v : LOCAL_PREFS[key].default;
}
function setLocalPref(key, value) {
  try { localStorage.setItem(LOCAL_PREFS_KEY, JSON.stringify({ ...readLocalPrefs(), [key]: value })); } catch {}
  LOCAL_PREFS[key].apply(value);
}
for (const key of Object.keys(LOCAL_PREFS)) LOCAL_PREFS[key].apply(getLocalPref(key));

function makeRowShell(className, tip) {
  const wrapper = document.createElement("div");
  const row = document.createElement("div");
  row.className = className;
  wrapper.appendChild(row);
  if (tip) {
    const tipEl = document.createElement("div");
    tipEl.className = "tip";
    tipEl.textContent = tip;
    wrapper.appendChild(tipEl);
  }
  return { wrapper, row };
}

// `clamp: true` opts a row OUT of free numeric entry: the number box stays
// bounded by the slider, exactly as every row behaved before. Used for
// parameters the backend requires to be in a specific range (pose detection).
function makeRowRange({ label, key, min, max, step, fmt, tip, clamp }) {
  const { wrapper, row } = makeRowShell("row", tip);

  const lab = document.createElement("label");
  lab.textContent = label;

  const input = document.createElement("input");
  input.type = "range"; input.min = String(min); input.max = String(max); input.step = String(step);
  input.dataset.key = key;

  // The number box is NOT bounded by the slider \u2014 typing accepts any value so
  // parameters can be pushed past their slider range. No min/max attributes
  // (they would trigger native validation) and step "any" so arbitrary
  // precision is allowed regardless of the slider's step.
  const val = document.createElement("input");
  val.type = "number";
  if (clamp) {
    val.min = String(min);
    val.max = String(max);
    val.step = String(step);
  } else {
    val.step = "any";
  }

  // A number input can only display a numeric value \u2014 strip any unit suffix
  // (e.g. the "\u00d7" that master-multiplier rows append) or the box renders blank.
  const numFmt = (raw) => {
    const s = fmt ? String(fmt(raw)) : String(raw);
    const m = s.match(/-?\d*\.?\d+/);
    return m ? m[0] : s;
  };

  // Out-of-range styling is derived from the value itself, never from "the user
  // typed it". The main page echoes state back on every frame of a scene slew,
  // and each echo rewrites this box via setValue() \u2014 a one-shot flag would be
  // wiped by the first echo while the value was still out of range.
  const markRange = (v) => {
    if (clamp) return; // can never be out of range
    val.classList.toggle("out-of-range", isFinite(v) && (v < min || v > max));
  };

  // The parameter's true value. Never read it back from `input`: a range
  // input clamps to its own min/max, so an out-of-range value typed into the
  // box would come back as the slider's end stop (that clamped scene exports).
  let current = min;

  val.value = numFmt(min);
  markRange(min);

  // Slider always wins: its value is in range by construction, so piping it
  // back into the box also clears any out-of-range marking.
  input.addEventListener("input", () => {
    const v = parseFloat(input.value);
    current = v;
    val.value = numFmt(input.value);
    markRange(v);
    sendSet(key, v);
  });

  val.addEventListener("change", () => {
    let v = parseFloat(val.value);
    // Unparseable or non-finite (e.g. 1e400 → Infinity): show the value
    // still in effect instead (state.js would refuse Infinity anyway).
    if (!isFinite(v)) { val.value = numFmt(current); markRange(current); return; }
    if (clamp) {
      v = Math.min(max, Math.max(min, v));
      val.value = numFmt(v);
    }
    current = v;
    input.value = v;   // range input self-clamps; handle parks at an end
    markRange(v);
    sendSet(key, v);
  });

  val.addEventListener("keydown", (e) => {
    if (e.key === "Enter") val.blur();
  });

  row.appendChild(lab);
  row.appendChild(input);
  row.appendChild(val);
  // Empty cell for grid alignment (replaces old map button column)
  row.appendChild(document.createElement("div"));

  inputsByKey.set(key, {
    input,
    getValue: () => current,
    setValue: (v) => {
      const n = parseFloat(v);
      if (isFinite(n)) current = n;
      input.value = v;
      val.value = numFmt(v);
      markRange(n);
    },
  });

  return wrapper;
}

function makeRowCheckbox({ label, key, tip, local }) {
  const { wrapper, row } = makeRowShell("chk", tip);

  const input = document.createElement("input");
  input.type = "checkbox"; input.id = `chk-${key}`; input.dataset.key = key;

  const lab = document.createElement("label");
  lab.setAttribute("for", input.id);
  lab.textContent = label;

  // Local preference: lives in localStorage and LOCAL_PREFS, stays out of
  // inputsByKey so state sync, scene export and the randomizer never see it.
  if (local) {
    input.checked = getLocalPref(key);
    input.addEventListener("change", () => setLocalPref(key, input.checked));
    row.appendChild(input);
    row.appendChild(lab);
    return wrapper;
  }

  input.addEventListener("change", () => {
    sendSet(key, input.checked);
    toggleChildren(key, input.checked);
  });

  row.appendChild(input);
  row.appendChild(lab);

  inputsByKey.set(key, { input, setValue: (v) => { input.checked = !!v; } });

  return wrapper;
}

// ─── Re-detect Display (Setup → Debug) ─────────────────────────
// The button sends display-refresh: every machine's main page re-reads its
// screen and answers with a display-info report (slaves' reports are relayed
// up to the master). The reports are listed under the button so mismatches
// show from the master without opening DevTools. A command, not a key: it
// never reaches state, scenes or the randomizer.
const displayReports = new Map(); // "ip|role" (names may repeat) → latest report
const displayReportEl = document.createElement("div");
displayReportEl.className = "display-reports";

function makeRowDisplayRefresh({ label, tip }) {
  const { wrapper, row } = makeRowShell("chk", tip);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = label;
  btn.addEventListener("click", () => {
    displayReports.clear();
    displayReportEl.textContent = "Waiting for replies…";
    chan.postMessage({ type: "display-refresh" });
  });
  row.appendChild(btn);
  row.after(displayReportEl); // between the button and its tip
  return wrapper;
}

function renderDisplayReports() {
  displayReportEl.textContent = "";
  const reports = [...displayReports.values()];
  // Density and canvas size must match across machines for boids to look alike
  const disagree = (f) => new Set(reports.map(f)).size > 1;
  const densityOff = disagree(r => r.density);
  const canvasOff = disagree(r => r.canvas.join("×"));
  for (const r of reports) {
    const line = document.createElement("div");
    const part = (text, warn, title) => {
      const s = document.createElement("span");
      s.textContent = text;
      if (warn) s.className = "warn";
      if (title) s.title = title;
      line.appendChild(s);
    };
    part(`${r.host || "?"}${r.role && r.role !== "standalone" ? ` (${r.role})` : ""}`, false, r.ip);
    // A fractional ratio means Chrome zoom isn't 100% or macOS scales the display
    part(`DPR ${+r.dpr.toFixed(2)}`, !Number.isInteger(r.dpr), "Fractional: Chrome zoom isn't 100% (Cmd+0) or the display is scaled");
    part(`density ${r.density}`, densityOff);
    part(`${r.canvas[0]}×${r.canvas[1]}`, canvasOff);
    if (r.canvas[0] !== r.screen[0] || r.canvas[1] !== r.screen[1]) {
      part(`screen ${r.screen[0]}×${r.screen[1]}`, true, "The canvas doesn't fill the screen: window not full screen (press F)");
    }
    if (r.recording) part("recording, not re-read", true);
    displayReportEl.appendChild(line);
  }
}

function makeRowSelect({ label, key, options, tip }) {
  const { wrapper, row } = makeRowShell("row", tip);

  const lab = document.createElement("label");
  lab.textContent = label;

  const select = document.createElement("select");
  select.dataset.key = key;

  // Placeholder while waiting for device list
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Loading\u2026";
  placeholder.disabled = true;
  placeholder.selected = true;
  select.appendChild(placeholder);

  select.addEventListener("change", () => {
    if (select.value) {
      chan.postMessage({ type: "switch-camera", deviceId: select.value });
    }
    updateCameraGate(select);
  });

  row.appendChild(lab);
  row.appendChild(select);
  row.appendChild(document.createElement("div")); // empty cell for grid alignment

  inputsByKey.set(key, {
    input: select,
    setValue: (deviceId) => { select.value = deviceId; },
    setOptions: (devices, currentDeviceId) => {
      select.innerHTML = "";
      // No camera is opened at startup — the operator must pick one. Keep an
      // explicit "none" entry selected until they do, rather than defaulting
      // to the first device in the list. With the gate off this only appears
      // when nothing is running anyway (e.g. permission denied).
      if (CAMERA_GATE_ENABLED || !currentDeviceId) {
        const none = document.createElement("option");
        none.value = "";
        none.textContent = devices.length
          ? "— No camera selected —"
          : "— No cameras found —";
        none.disabled = true;
        select.appendChild(none);
      }
      for (const d of devices) {
        const opt = document.createElement("option");
        opt.value = d.deviceId;
        opt.textContent = d.label;
        select.appendChild(opt);
      }
      select.value = currentDeviceId || "";
      updateCameraGate(select);
    }
  });

  return wrapper;
}

// Helpers for hex <-> RGB conversion
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.substring(0, 2), 16), parseInt(h.substring(2, 4), 16), parseInt(h.substring(4, 6), 16)];
}
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(c => Math.round(c).toString(16).padStart(2, '0')).join('');
}

function makeRowColor({ label, key, rgbKeys, alphaKey, tip }) {
  const { wrapper, row } = makeRowShell("row color-row", tip);

  const lab = document.createElement("label");
  lab.textContent = label;

  const input = document.createElement("input");
  input.type = "color";
  input.dataset.key = key;

  input.addEventListener("input", () => {
    if (rgbKeys) {
      const [r, g, b] = hexToRgb(input.value);
      sendSet(rgbKeys[0], r);
      sendSet(rgbKeys[1], g);
      sendSet(rgbKeys[2], b);
    } else {
      sendSet(key, input.value);
    }
  });

  row.appendChild(lab);
  row.appendChild(input);

  if (alphaKey) {
    const alphaInput = document.createElement("input");
    alphaInput.type = "number";
    alphaInput.min = "0";
    alphaInput.max = "1";
    alphaInput.step = "0.05";
    alphaInput.style.cssText = "width:3.5em;margin-left:6px;";
    alphaInput.dataset.key = alphaKey;
    alphaInput.addEventListener("input", () => sendSet(alphaKey, +alphaInput.value));
    row.appendChild(alphaInput);
    inputsByKey.set(alphaKey, { input: alphaInput, setValue: (v) => { alphaInput.value = +v; } });
  }

  inputsByKey.set(key, { input, rgbKeys, setValue: (v) => {
    input.value = v;
  }});

  return wrapper;
}

// Tab definitions
const TAB_ICONS = {
  pose:    '<path d="M12 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/><path d="M12 8v5m0 0l-3 7m3-7l3 7m-6-9l-3-1m9 1l3-1"/>',
  body:    '<circle cx="12" cy="4" r="2"/><line x1="12" y1="6" x2="12" y2="14"/><line x1="8" y1="9" x2="16" y2="9"/><line x1="12" y1="14" x2="9" y2="21"/><line x1="12" y1="14" x2="15" y2="21"/>',
  boids:   '<circle cx="12" cy="12" r="9"/>',
  appearance: '<circle cx="13.5" cy="6.5" r="2.5"/><path d="M17.5 10c-1.8 0-3.2.7-4 2l-1.5 3L6 21H3l4-8 1.5-3c.8-1.3 2.2-2 4-2h5"/>',
  rand:    '<path d="M18 4l3 3-3 3"/><path d="M2 12h4l3-8h2l3 8h2l2-4h3"/><path d="M18 14l3 3-3 3"/>',
};

const TABS = [
  { id: "pose",    label: "Pose" },
  { id: "boids",   label: "Boids" },
  { id: "appearance", label: "Appearance" },
  { id: "rand",    label: "Rand" },
];

// ─── Body skeleton SVG data ─────────────────────────────────────
const BODY_COORDS = [
  { x: 100, y: 30 },   // 0 nose
  { x: 110, y: 22 },   // 1 leftEye
  { x: 90,  y: 22 },   // 2 rightEye
  { x: 120, y: 28 },   // 3 leftEar
  { x: 80,  y: 28 },   // 4 rightEar
  { x: 130, y: 80 },   // 5 leftShoulder
  { x: 70,  y: 80 },   // 6 rightShoulder
  { x: 150, y: 130 },  // 7 leftElbow
  { x: 50,  y: 130 },  // 8 rightElbow
  { x: 160, y: 180 },  // 9 leftWrist
  { x: 40,  y: 180 },  // 10 rightWrist
  { x: 120, y: 190 },  // 11 leftHip
  { x: 80,  y: 190 },  // 12 rightHip
  { x: 125, y: 260 },  // 13 leftKnee
  { x: 75,  y: 260 },  // 14 rightKnee
  { x: 128, y: 330 },  // 15 leftAnkle
  { x: 72,  y: 330 },  // 16 rightAnkle
];

const BODY_BONES = [
  [0,1],[0,2],[1,3],[2,4],           // head
  [5,6],                              // shoulders
  [5,7],[7,9],[6,8],[8,10],           // arms
  [5,11],[6,12],[11,12],              // torso
  [11,13],[13,15],[12,14],[14,16],    // legs
];

const KP_NAMES = [
  'nose', 'leftEye', 'rightEye', 'leftEar', 'rightEar',
  'leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow',
  'leftWrist', 'rightWrist', 'leftHip', 'rightHip',
  'leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle',
];

let lastState = {};              // most recent merged state, so dynamically-built rows can init
const bodySvgByKp = new Map();   // kp index → SVG circle element
const kpGroupByIndex = new Map(); // kp index → { sec, wKey, rKey } detail-panel group
let kpDetailPanel = null;         // right-hand container that holds active-keypoint groups
let kpDetailEmpty = null;         // placeholder shown when no keypoint is active

// Build (or rebuild) the weight/radius detail group for an active keypoint,
// inserting it into the panel in body order. Values init from lastState.
function buildKpGroup(i) {
  if (kpGroupByIndex.has(i)) return;
  const wKey = `kp${i}Weight`, rKey = `kp${i}Radius`;
  const fmt1 = v => (+v).toFixed(1);
  const sec = makeSection(KP_NAMES[i]);
  sec.dataset.kp = i;
  sec.appendChild(makeRowRange({ label: "weight", key: wKey, min: 0, max: 5, step: 0.1, fmt: fmt1 }));
  sec.appendChild(makeRowRange({ label: "radius", key: rKey, min: 0, max: 5, step: 0.1, fmt: fmt1 }));

  // Keep groups ordered by keypoint index.
  let ref = null;
  for (const child of kpDetailPanel.querySelectorAll(".section")) {
    if (+child.dataset.kp > i) { ref = child; break; }
  }
  kpDetailPanel.insertBefore(sec, ref);
  kpGroupByIndex.set(i, { sec, wKey, rKey });

  const wui = inputsByKey.get(wKey);
  if (wui && lastState[wKey] !== undefined) wui.setValue(lastState[wKey]);
  const rui = inputsByKey.get(rKey);
  if (rui && lastState[rKey] !== undefined) rui.setValue(lastState[rKey]);
  updateKpEmptyHint();
}

function removeKpGroup(i) {
  const g = kpGroupByIndex.get(i);
  if (!g) return;
  g.sec.remove();
  inputsByKey.delete(g.wKey);
  inputsByKey.delete(g.rKey);
  kpGroupByIndex.delete(i);
  updateKpEmptyHint();
}

// Reflect a keypoint's active state in both the skeleton node and the detail panel.
function setKpActive(i, active) {
  const circle = bodySvgByKp.get(i);
  if (circle) circle.setAttribute("class", "kp-node " + (active ? "active" : "inactive"));
  if (active) buildKpGroup(i); else removeKpGroup(i);
}

function updateKpEmptyHint() {
  if (kpDetailEmpty) kpDetailEmpty.style.display = kpGroupByIndex.size === 0 ? "" : "none";
}

function buildBodySVG(container) {
  const layout = document.createElement("div");
  layout.className = "pose-body-layout";

  const wrap = document.createElement("div");
  wrap.className = "body-svg-wrap";

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 200 360");

  // Draw bones
  for (const [a, b] of BODY_BONES) {
    const line = document.createElementNS(svgNS, "line");
    line.setAttribute("x1", BODY_COORDS[a].x);
    line.setAttribute("y1", BODY_COORDS[a].y);
    line.setAttribute("x2", BODY_COORDS[b].x);
    line.setAttribute("y2", BODY_COORDS[b].y);
    line.setAttribute("class", "bone");
    svg.appendChild(line);
  }

  // Draw keypoint nodes — click toggles the keypoint active and shows/hides its controls.
  for (let i = 0; i < 17; i++) {
    const circle = document.createElementNS(svgNS, "circle");
    circle.setAttribute("cx", BODY_COORDS[i].x);
    circle.setAttribute("cy", BODY_COORDS[i].y);
    circle.setAttribute("r", "10");
    circle.setAttribute("class", "kp-node inactive");
    circle.dataset.kp = i;
    circle.addEventListener("click", () => {
      const key = `kp${i}`;
      const next = !lastState[key];
      lastState[key] = next;
      sendSet(key, next);
      setKpActive(i, next);
    });
    svg.appendChild(circle);
    bodySvgByKp.set(i, circle);
  }

  wrap.appendChild(svg);
  layout.appendChild(wrap);

  // Right-hand detail panel — active keypoints' weight/radius groups land here.
  kpDetailPanel = document.createElement("div");
  kpDetailPanel.className = "kp-detail-panel";
  kpDetailEmpty = document.createElement("div");
  kpDetailEmpty.className = "kp-detail-empty";
  kpDetailEmpty.textContent = "Tap a keypoint on the skeleton to enable it and edit its weight & radius.";
  kpDetailPanel.appendChild(kpDetailEmpty);
  layout.appendChild(kpDetailPanel);

  container.appendChild(layout);
}

let activeTab = "pose";
const tabContainers = new Map();

function buildUI() {
  root.innerHTML = "";

  // Build tab bar
  const tabBar = document.getElementById("tab-bar");
  tabBar.innerHTML = "";
  for (const tab of TABS) {
    const btn = document.createElement("button");
    btn.className = "tab-btn" + (tab.id === activeTab ? " active" : "");
    btn.dataset.tab = tab.id;
    const iconSvg = TAB_ICONS[tab.id];
    if (iconSvg) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.innerHTML = iconSvg;
      btn.appendChild(svg);
    }
    const span = document.createElement("span");
    span.textContent = tab.label;
    btn.appendChild(span);
    btn.addEventListener("click", () => switchTab(tab.id));
    tabBar.appendChild(btn);
  }

  // Create a container div for each tab
  for (const tab of TABS) {
    const container = document.createElement("div");
    container.className = "tab-content";
    container.dataset.tab = tab.id;
    container.style.display = tab.id === activeTab ? "" : "none";
    tabContainers.set(tab.id, container);
    root.appendChild(container);
  }

  // "settings" is NOT a tab — its sections mount into the cog side panel.
  // Deliberately kept out of tabContainers: switchTab() hides every container
  // in that map except the active one, which would blank the panel on the
  // first tab switch.
  const settingsBody = document.getElementById("settings-body");
  if (settingsBody) settingsBody.innerHTML = "";

  // Build sections into their tab containers
  const lastGroupIn = new Map(); // container → group of the last section placed in it
  for (const section of CONTROLS) {
    if (section.hidden) continue; // declared for the Randomizer only
    const tabId = section.tab || "boids";
    const container = tabId === "settings" ? settingsBody : tabContainers.get(tabId);
    if (!container) continue;
    // Divider between `group` runs (none above the first)
    if (section.group && lastGroupIn.has(container) && section.group !== lastGroupIn.get(container)) {
      const gh = document.createElement("div");
      gh.className = "section-group";
      gh.setAttribute("role", "separator");
      container.appendChild(gh);
    }
    lastGroupIn.set(container, section.group);
    // Sections with an `enableKey` carry their on/off control in the header
    // and collapse their body when off. `body` is where rows go — for plain
    // sections it is the section element itself.
    const secEl = section.enableKey
      ? makeSectionWithEnable(section.title, section.enableKey)
      : makeSection(section.title);
    const body = secEl._body || secEl;
    // Consecutive `tile` rows share one grid container (side by side instead
    // of stacked). A tile run under a parent carries the sub-row indent on the
    // container, not on each tile.
    let tiles = null;
    for (const row of section.rows) {
      let wrapper;
      if (row.type === "range") {
        wrapper = makeRowRange(row);
      } else if (row.type === "checkbox") {
        wrapper = makeRowCheckbox(row);
      } else if (row.type === "select") {
        wrapper = makeRowSelect(row);
      } else if (row.type === "color") {
        wrapper = makeRowColor(row);
      } else if (row.type === "display-refresh") {
        wrapper = makeRowDisplayRefresh(row);
      }
      if (wrapper) {
        if (row.parent) {
          if (!row.tile) wrapper.classList.add("sub-row");
          wrapper.style.display = "none";
          if (!childKeysOf.has(row.parent)) childKeysOf.set(row.parent, []);
          childKeysOf.get(row.parent).push(row.key);
        }
        if (row.key) wrappersByKey.set(row.key, wrapper);
        if (row.tile) {
          if (!tiles) {
            tiles = document.createElement("div");
            tiles.className = row.parent ? "row-tiles sub-row" : "row-tiles";
            body.appendChild(tiles);
          }
          tiles.appendChild(wrapper);
        } else {
          tiles = null;
          body.appendChild(wrapper);
        }
      }
    }
    container.appendChild(secEl);
  }

  // Mount the interactive skeleton + keypoint detail panel into the Pose tab.
  // Detection moved to the setup panel, so this is now the tab's only content:
  // which joints attract boids, and their weights/radii — all live controls.
  const poseContainer = tabContainers.get("pose");
  if (poseContainer) {
    buildBodySVG(poseContainer);
  }

  // Build Randomizer tab
  const randContainer = tabContainers.get("rand");
  if (randContainer) buildRandomizerTab(randContainer);

  // Mount the live model diagram at the bottom of the Boids tab.
  const boidsContainer = tabContainers.get("boids");
  if (boidsContainer) buildModelViz(boidsContainer);
}

// ─── Live model diagram (Boids tab) ──────────────────────────────
// Visual companion to the interaction sliders: two side-by-side columns,
// boid↔boid and boid↔body. In each, concentric rings show the interaction
// radii around the boid (hard eligibility cutoff) and marks above/below a
// zero baseline show the signed weights. Tracks slider moves and incoming
// state in real time.
//
// Both panels are RELATIVE, not absolute: each scales to the largest
// effective value in its group (base × ★ multiplier), so the biggest ring /
// tallest mark always spans the panel and the others show their ratio to it.
// Values far beyond the slider range therefore never pile up on the edge.
// The force panel prints its absolute scale at the ± axis ends, and that
// scale never drops below ±1 (MODEL_W_SCALE_MIN), so a group of tiny weights
// stays visibly small instead of being zoomed up to full height. Each force
// mark rides a vertical track with a fill from the baseline, so it reads as
// a slider.
const MODEL_COLORS = { separation: "#e0a800", alignment: "#4fb477", cohesion: "#3f8efc" };
// Where each ring's letter sits, in degrees counter-clockwise from 3 o'clock.
// Spread 120° apart so the three tags never overlap, whatever the radii are.
const RING_LABEL_ANGLES = { separation: 90, alignment: 210, cohesion: 330 };
const RING_TAG_R = 10;   // radius of the background disc behind each letter
// Tags ride on the circumference itself. At tiny radii that would stack all
// three on the centre dot, so hold them out far enough to stay separated.
const RING_TAG_MIN = 14;
// Force marks carry the same tags. Half-width is wide enough that the disc
// doesn't swallow the whole mark — columns are 42 apart, so 18 leaves a gap.
const MARK_HALF_W = 18;
const MODEL_W_MAX = 6;     // weight slider extent (input / drag clamp)
const MODEL_W_SCALE_MIN = 1; // force axis never zooms in past ±1
const MODEL_SPAN = 90;     // px from centre/baseline that the largest value reaches
// Radii are boid-size factors now, so the diagram works in fractional steps
// rather than whole pixels. Matches the radius rows in CONTROLS.
const RADIUS_STEP = 0.05;
const MODEL_CONFIGS = [
  {
    title: "Boid ↔ Boid",
    radiiKeys:  { separation: "separationRadius", alignment: "alignmentRadius", cohesion: "cohesionRadius" },
    weightKeys: { separation: "separationWeight", alignment: "alignmentWeight", cohesion: "cohesionWeight" },
    radiiMultKey: "boidRadiiMult",
    weightsMultKey: "boidWeightsMult",
    rMax: 5,         // radius slider max (in boid-size factors)
    rDefault: 2.5,
  },
  {
    title: "Body ↔ Boid",
    radiiKeys:  { separation: "bodySeparationRadius", alignment: "bodyAlignmentRadius", cohesion: "bodyCohesionRadius" },
    weightKeys: { separation: "bodySeparationWeight", alignment: "bodyAlignmentWeight", cohesion: "bodyCohesionWeight" },
    radiiMultKey: "bodyRadiiMult",
    weightsMultKey: "bodyWeightsMult",
    rMax: 5,
    rDefault: 4.0,
  },
];
const MODEL_KEYS = new Set(MODEL_CONFIGS.flatMap(c =>
  [...Object.values(c.radiiKeys), ...Object.values(c.weightKeys), c.radiiMultKey, c.weightsMultKey]));
// Current multiplier for a config, falling back to 1 before first sync
function modelMult(key) {
  return lastState[key] !== undefined ? +lastState[key] : 1;
}
function modelVal(key, fallback) {
  return lastState[key] !== undefined ? +lastState[key] : fallback;
}
// Diagram scales: the largest effective radius / largest |effective weight|
// in a group. The radius scale is 0 when every radius is 0; the weight scale
// never drops below MODEL_W_SCALE_MIN, so small weights read as small.
function modelRadiusScale(cfg) {
  const mult = modelMult(cfg.radiiMultKey);
  let s = 0;
  for (const key of Object.values(cfg.radiiKeys)) s = Math.max(s, modelVal(key, cfg.rDefault) * mult);
  return s;
}
function modelWeightScale(cfg) {
  const mult = modelMult(cfg.weightsMultKey);
  let s = MODEL_W_SCALE_MIN;
  for (const key of Object.values(cfg.weightKeys)) s = Math.max(s, Math.abs(modelVal(key, 1) * mult));
  return s;
}
const modelVizInstances = [];

function buildModelViz(container) {
  const sec = makeSection("Controls");
  const pair = document.createElement("div");
  pair.className = "model-viz-pair";
  sec.appendChild(pair);
  for (const cfg of MODEL_CONFIGS) buildModelVizColumn(pair, cfg);
  container.appendChild(sec);
  updateModelViz();
}

function buildModelVizColumn(pair, cfg) {
  const NS = "http://www.w3.org/2000/svg";
  const wrap = document.createElement("div");
  wrap.className = "model-viz";
  pair.appendChild(wrap);

  const head = document.createElement("div");
  head.className = "model-viz-head";
  head.textContent = cfg.title;
  wrap.appendChild(head);

  function panel(title, viewBox) {
    const box = document.createElement("div");
    box.className = "model-viz-panel";
    const h = document.createElement("div");
    h.className = "model-viz-title";
    h.textContent = title;
    box.appendChild(h);
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", viewBox);
    box.appendChild(svg);
    wrap.appendChild(box);
    return svg;
  }

  // Legend table: force names (in their colors) + live radius/weight values
  const legend = document.createElement("table");
  legend.className = "model-viz-legend";
  const thead = document.createElement("tr");
  for (const h of ["", "Radius", "Force"]) {
    const th = document.createElement("th");
    th.textContent = h;
    thead.appendChild(th);
  }
  legend.appendChild(thead);
  // Editable number cell — mirrors makeRowRange's number box: clamp on
  // change, sync the matching slider row, send the new value.
  function makeLegendInput(key, min, max, step) {
    const input = document.createElement("input");
    input.type = "number";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.addEventListener("change", () => {
      let v = parseFloat(input.value);
      if (isNaN(v)) return;
      v = Math.min(max, Math.max(min, v));
      const ui = inputsByKey.get(key);
      if (ui) ui.setValue(v);
      sendSet(key, v);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") input.blur();
    });
    return input;
  }

  const vals = {};
  for (const name of Object.keys(cfg.radiiKeys)) {
    const tr = document.createElement("tr");
    const nameTd = document.createElement("td");
    nameTd.textContent = name.charAt(0).toUpperCase() + name.slice(1);
    nameTd.style.color = MODEL_COLORS[name];
    tr.appendChild(nameTd);
    const rTd = document.createElement("td");
    const wTd = document.createElement("td");
    const rIn = makeLegendInput(cfg.radiiKeys[name], 0, cfg.rMax, RADIUS_STEP);
    const wIn = makeLegendInput(cfg.weightKeys[name], -MODEL_W_MAX, MODEL_W_MAX, 0.1);
    rTd.appendChild(rIn);
    wTd.appendChild(wIn);
    tr.appendChild(rTd);
    tr.appendChild(wTd);
    legend.appendChild(tr);
    vals[name] = { r: rIn, w: wIn };
  }

  // "★ × All" row — master multipliers. They scale every value in the group
  // equally, so the ratios (and the geometry) hold still; the legend values
  // and the force axis labels show the change.
  const multTr = document.createElement("tr");
  const multName = document.createElement("td");
  multName.textContent = "★ × All";
  multName.style.color = "var(--text-secondary)";
  multTr.appendChild(multName);
  const mrTd = document.createElement("td");
  const mwTd = document.createElement("td");
  const mrIn = makeLegendInput(cfg.radiiMultKey, 0, 5, 0.01);
  const mwIn = makeLegendInput(cfg.weightsMultKey, 0, 5, 0.01);
  mrTd.appendChild(mrIn);
  mwTd.appendChild(mwIn);
  multTr.appendChild(mrTd);
  multTr.appendChild(mwTd);
  legend.appendChild(multTr);
  const multVals = { r: mrIn, w: mwIn };

  wrap.appendChild(legend);

  // Radii: eligibility rings centered on the boid, scaled so the largest
  // effective radius sits at MODEL_SPAN
  const rSvg = panel("Radii", "0 0 200 200");
  const rings = {};
  for (const name of Object.keys(cfg.radiiKeys)) {
    const c = document.createElementNS(NS, "circle");
    c.setAttribute("cx", "100");
    c.setAttribute("cy", "100");
    c.setAttribute("fill", "none");
    c.setAttribute("stroke", MODEL_COLORS[name]);
    c.setAttribute("stroke-width", "2");
    rSvg.appendChild(c);
    rings[name] = c;
  }
  const dot = document.createElementNS(NS, "circle");
  dot.setAttribute("cx", "100");
  dot.setAttribute("cy", "100");
  dot.setAttribute("r", "5");
  dot.setAttribute("class", "model-dot");
  rSvg.appendChild(dot);

  // S/A/C tags riding on each ring's circumference. A background-filled disc
  // sits under each letter so it punches a clean hole in the ring stroke.
  // Each force sits at its own angle (see RING_LABEL_ANGLES) so the tags stay
  // apart even when two radii coincide. Appended after the rings and the dot
  // so they draw on top; pointer-events off so they never swallow a ring drag.
  const ringLabels = {};
  for (const name of Object.keys(cfg.radiiKeys)) {
    const bg = document.createElementNS(NS, "circle");
    bg.setAttribute("r", String(RING_TAG_R));
    bg.setAttribute("class", "ring-tag-bg");
    bg.setAttribute("pointer-events", "none");
    rSvg.appendChild(bg);
    const t = document.createElementNS(NS, "text");
    t.setAttribute("fill", MODEL_COLORS[name]);
    t.setAttribute("font-size", "14");
    t.setAttribute("font-weight", "700");
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("dominant-baseline", "central");
    t.setAttribute("pointer-events", "none");
    t.textContent = name.charAt(0).toUpperCase();
    rSvg.appendChild(t);
    ringLabels[name] = { bg, text: t };
  }

  // Force: one signed mark per force — height above/below the zero baseline
  const fSvg = panel("Force", "0 0 200 200");
  const xCenters = { separation: 62, alignment: 104, cohesion: 146 };
  // Slider furniture under each mark: a full-height track (reads as "this
  // moves vertically") and a coloured fill from the baseline to the mark.
  // Drawn first so the baseline, marks and tags sit on top.
  const fills = {};
  for (const name of Object.keys(cfg.weightKeys)) {
    const track = document.createElementNS(NS, "line");
    track.setAttribute("x1", String(xCenters[name])); track.setAttribute("x2", String(xCenters[name]));
    track.setAttribute("y1", String(100 - MODEL_SPAN)); track.setAttribute("y2", String(100 + MODEL_SPAN));
    track.setAttribute("class", "model-track");
    fSvg.appendChild(track);
    const fill = document.createElementNS(NS, "line");
    fill.setAttribute("x1", String(xCenters[name])); fill.setAttribute("x2", String(xCenters[name]));
    fill.setAttribute("y1", "100"); fill.setAttribute("y2", "100");
    fill.setAttribute("stroke", MODEL_COLORS[name]);
    fill.setAttribute("class", "model-track-fill");
    fSvg.appendChild(fill);
    fills[name] = fill;
  }
  const base = document.createElementNS(NS, "line");
  base.setAttribute("x1", "36"); base.setAttribute("y1", "100");
  base.setAttribute("x2", "172"); base.setAttribute("y2", "100");
  base.setAttribute("class", "model-baseline");
  base.setAttribute("stroke-width", "1");
  fSvg.appendChild(base);
  const zero = document.createElementNS(NS, "text");
  // Axis labels right-aligned against the baseline start (x 36)
  zero.setAttribute("x", "32"); zero.setAttribute("y", "103");
  zero.setAttribute("text-anchor", "end");
  zero.setAttribute("class", "model-zero");
  zero.setAttribute("font-size", "10");
  zero.textContent = "0";
  fSvg.appendChild(zero);
  // Axis ends: the effective weight the top / bottom of the panel stands for
  const wTop = document.createElementNS(NS, "text");
  wTop.setAttribute("x", "32"); wTop.setAttribute("text-anchor", "end"); wTop.setAttribute("y", String(100 - MODEL_SPAN + 3));
  wTop.setAttribute("class", "model-zero");
  fSvg.appendChild(wTop);
  const wBot = document.createElementNS(NS, "text");
  wBot.setAttribute("x", "32"); wBot.setAttribute("text-anchor", "end"); wBot.setAttribute("y", String(100 + MODEL_SPAN + 3));
  wBot.setAttribute("class", "model-zero");
  fSvg.appendChild(wBot);
  const scaleLabels = { wTop, wBot };
  const marks = {};
  for (const name of Object.keys(cfg.weightKeys)) {
    const m = document.createElementNS(NS, "line");
    m.setAttribute("x1", String(xCenters[name] - MARK_HALF_W));
    m.setAttribute("x2", String(xCenters[name] + MARK_HALF_W));
    m.setAttribute("stroke", MODEL_COLORS[name]);
    m.setAttribute("stroke-width", "3");
    m.setAttribute("stroke-linecap", "round");
    fSvg.appendChild(m);
    marks[name] = m;
  }

  // Matching S/A/C tags for the force marks — same disc-on-the-line treatment
  // as the rings. Built in a second pass so every tag draws over every mark.
  const markLabels = {};
  for (const name of Object.keys(cfg.weightKeys)) {
    const bg = document.createElementNS(NS, "circle");
    bg.setAttribute("cx", String(xCenters[name]));
    bg.setAttribute("r", String(RING_TAG_R));
    bg.setAttribute("class", "ring-tag-bg");
    bg.setAttribute("pointer-events", "none");
    fSvg.appendChild(bg);
    const t = document.createElementNS(NS, "text");
    t.setAttribute("x", String(xCenters[name]));
    t.setAttribute("fill", MODEL_COLORS[name]);
    t.setAttribute("font-size", "14");
    t.setAttribute("font-weight", "700");
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("dominant-baseline", "central");
    t.setAttribute("pointer-events", "none");
    t.textContent = name.charAt(0).toUpperCase();
    fSvg.appendChild(t);
    markLabels[name] = { bg, text: t };
  }

  // ── Direct manipulation: drag rings (radius) and marks (weight) ──
  function svgPoint(svg, e) {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }
  function applyModelValue(key, v) {
    const ui = inputsByKey.get(key);
    if (ui) ui.setValue(v);
    sendSet(key, v);
  }

  rSvg.style.touchAction = "none";
  fSvg.style.touchAction = "none";
  fSvg.style.cursor = "ns-resize";

  // Scale frozen for the duration of a drag. The diagram normally rescales to
  // its largest value, so dragging the biggest ring would rescale under the
  // pointer and the value would run away. Held from pointerdown, released
  // (and the diagram renormalised) on pointerup. null = live scale.
  // When a group is all zeros, fall back to the slider extent so there is
  // still something to drag against.
  const frozen = { r: null, w: null };

  // Rings: grab within tolerance of a ring, then radial distance = radius.
  // Nearest-ring pick (not element hit) so coincident rings stay grabbable.
  let ringKey = null;
  rSvg.addEventListener("pointerdown", (e) => {
    const p = svgPoint(rSvg, e);
    const dist = Math.hypot(p.x - 100, p.y - 100);
    let best = null, bestDelta = 6;
    for (const [name, key] of Object.entries(cfg.radiiKeys)) {
      const delta = Math.abs(dist - parseFloat(rings[name].getAttribute("r")));
      if (delta < bestDelta) { bestDelta = delta; best = key; }
    }
    if (!best) return;
    ringKey = best;
    frozen.r = modelRadiusScale(cfg) || cfg.rMax * modelMult(cfg.radiiMultKey);
    rSvg.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  rSvg.addEventListener("pointermove", (e) => {
    const p = svgPoint(rSvg, e);
    const dist = Math.hypot(p.x - 100, p.y - 100);
    if (!ringKey) {
      // Hover feedback: grab cursor only within reach of a ring
      let near = false;
      for (const name of Object.keys(cfg.radiiKeys)) {
        if (Math.abs(dist - parseFloat(rings[name].getAttribute("r"))) < 6) { near = true; break; }
      }
      rSvg.style.cursor = near ? "grab" : "default";
      return;
    }
    const multR = modelMult(cfg.radiiMultKey);
    if (multR < 0.01) return; // all rings collapsed — nothing to drag against
    const eff = dist / MODEL_SPAN * frozen.r;
    const raw = Math.max(0, Math.min(eff / multR, cfg.rMax));
    const v = Math.round(raw / RADIUS_STEP) * RADIUS_STEP;
    applyModelValue(ringKey, +v.toFixed(2));
  });
  const endRingDrag = () => {
    if (!ringKey) return;
    ringKey = null;
    frozen.r = null;
    updateModelViz(); // renormalise to the new largest radius
  };
  rSvg.addEventListener("pointerup", endRingDrag);
  rSvg.addEventListener("pointercancel", endRingDrag);

  // Marks: pick the column under the pointer, then height above/below the
  // baseline = signed weight. Pointerdown jumps the mark to the click.
  let markKey = null;
  function dragMarkTo(p) {
    const multW = modelMult(cfg.weightsMultKey);
    if (multW < 0.01) return; // all marks pinned to zero — nothing to drag against
    const raw = (100 - p.y) / MODEL_SPAN * frozen.w / multW;
    const v = Math.round(Math.max(-MODEL_W_MAX, Math.min(raw, MODEL_W_MAX)) * 10) / 10;
    applyModelValue(markKey, v);
  }
  fSvg.addEventListener("pointerdown", (e) => {
    const p = svgPoint(fSvg, e);
    let best = null, bestDx = MARK_HALF_W + 2; // stays under the 21 half-spacing
    for (const [name, key] of Object.entries(cfg.weightKeys)) {
      const dx = Math.abs(p.x - xCenters[name]);
      if (dx < bestDx) { bestDx = dx; best = key; }
    }
    if (!best) return;
    markKey = best;
    frozen.w = modelWeightScale(cfg);
    fSvg.setPointerCapture(e.pointerId);
    e.preventDefault();
    dragMarkTo(p);
  });
  fSvg.addEventListener("pointermove", (e) => {
    if (markKey) dragMarkTo(svgPoint(fSvg, e));
  });
  const endMarkDrag = () => {
    if (!markKey) return;
    markKey = null;
    frozen.w = null;
    updateModelViz(); // renormalise to the new largest weight
  };
  fSvg.addEventListener("pointerup", endMarkDrag);
  fSvg.addEventListener("pointercancel", endMarkDrag);

  modelVizInstances.push({ cfg, rings, ringLabels, marks, markLabels, fills, vals, multVals, scaleLabels, frozen });
}

function updateModelViz() {
  for (const inst of modelVizInstances) {
    const { cfg, rings, ringLabels, marks, markLabels, fills, vals, multVals, scaleLabels, frozen } = inst;
    const multR = modelMult(cfg.radiiMultKey);
    const multW = modelMult(cfg.weightsMultKey);
    // Live scale = largest value in the group; a drag holds it fixed.
    const scaleR = frozen.r ?? modelRadiusScale(cfg);
    const scaleW = frozen.w ?? modelWeightScale(cfg);
    scaleLabels.wTop.textContent = `+${scaleW.toFixed(1)}`;
    scaleLabels.wBot.textContent = `−${scaleW.toFixed(1)}`;
    for (const [name, key] of Object.entries(cfg.radiiKeys)) {
      const v = modelVal(key, cfg.rDefault);
      // Effective radius (base × multiplier) as a fraction of the largest.
      // Only a frozen scale can push past MODEL_SPAN; cap inside the panel.
      const r = scaleR > 0 ? Math.min(v * multR / scaleR * MODEL_SPAN, 98) : 0;
      rings[name].setAttribute("r", String(r));
      // Keep the tag pinned on its ring's circumference as the radius changes.
      const rad = RING_LABEL_ANGLES[name] * Math.PI / 180;
      const lr = Math.max(r, RING_TAG_MIN);
      const lx = (100 + lr * Math.cos(rad)).toFixed(1);
      const ly = (100 - lr * Math.sin(rad)).toFixed(1);
      const tag = ringLabels[name];
      tag.bg.setAttribute("cx", lx);
      tag.bg.setAttribute("cy", ly);
      tag.text.setAttribute("x", lx);
      tag.text.setAttribute("y", ly);
      const rIn = vals[name].r;
      if (document.activeElement !== rIn) rIn.value = (+v).toFixed(2);
    }
    for (const [name, key] of Object.entries(cfg.weightKeys)) {
      const v = modelVal(key, 1);
      // Effective weight (base × multiplier) as a signed fraction of the
      // largest magnitude; capped inside the panel while a drag holds the scale.
      const frac = v * multW / scaleW;
      const y = 100 - Math.max(-1.08, Math.min(frac, 1.08)) * MODEL_SPAN;
      marks[name].setAttribute("y1", String(y));
      marks[name].setAttribute("y2", String(y));
      fills[name].setAttribute("y2", String(y)); // baseline → mark
      // Tag rides the mark as it travels above/below the baseline.
      const mTag = markLabels[name];
      mTag.bg.setAttribute("cy", String(y));
      mTag.text.setAttribute("y", String(y));
      const wIn = vals[name].w;
      if (document.activeElement !== wIn) wIn.value = (+v).toFixed(1);
    }
    if (document.activeElement !== multVals.r) multVals.r.value = multR.toFixed(2);
    if (document.activeElement !== multVals.w) multVals.w.value = multW.toFixed(2);
  }
}

// ─── Randomizer tab ──────────────────────────────────────────────
const randParams = [];

// Tabs whose controls can be randomized, in display order.
const RAND_TABS = ["boids", "appearance"];
// Row types the randomizer knows how to randomize.
const RAND_TYPES = ["range", "checkbox", "color"];

// Randomize a single flagged control according to its type.
function randomizeParam(p) {
  if (p.type === "range") {
    const steps = Math.round((p.max - p.min) / p.step);
    const randStep = Math.floor(Math.random() * (steps + 1));
    const rounded = Math.round((p.min + randStep * p.step) / p.step) * p.step;
    sendSet(p.key, rounded);
    const ui = inputsByKey.get(p.key);
    if (ui) ui.setValue(rounded);
  } else if (p.type === "checkbox") {
    const val = Math.random() < 0.5;
    sendSet(p.key, val);
    const ui = inputsByKey.get(p.key);
    if (ui) ui.setValue(val);
  } else if (p.type === "color") {
    const r = Math.floor(Math.random() * 256);
    const g = Math.floor(Math.random() * 256);
    const b = Math.floor(Math.random() * 256);
    const hex = rgbToHex(r, g, b);
    const ui = inputsByKey.get(p.key);
    if (ui) ui.setValue(hex);
    if (p.rgbKeys) {
      sendSet(p.rgbKeys[0], r);
      sendSet(p.rgbKeys[1], g);
      sendSet(p.rgbKeys[2], b);
    } else {
      sendSet(p.key, hex);
    }
    // Colours with an inline alpha (path, COM) randomize their alpha too.
    if (p.alphaKey) {
      const a = Math.round(Math.random() * 100) / 100;
      sendSet(p.alphaKey, a);
      const au = inputsByKey.get(p.alphaKey);
      if (au) au.setValue(a);
    }
  }
}

// Randomizer section header with its own All/None pair, scoped to just the
// checkboxes in `chks`. That array is still being filled when this runs — the
// handlers read it on click, by which point it is complete.
function makeSectionWithToggles(title, chks) {
  const section = makeSection(title);
  const h = section.firstElementChild;
  h.style.display = "flex";
  h.style.alignItems = "center";
  h.style.justifyContent = "space-between";
  h.style.gap = "8px";

  const group = document.createElement("div");
  // h3 is uppercase + letter-spaced; reset so the buttons read as buttons
  group.style.cssText = "display:flex;gap:4px;align-items:center;text-transform:none;letter-spacing:normal;";

  // "Select" names what All/None act on — on their own the buttons don't say
  // whether they pick parameters or apply a value.
  const selectLab = document.createElement("span");
  selectLab.textContent = "Select";
  selectLab.style.cssText = "font-size:10px;color:var(--text-tertiary);margin-right:2px;";
  group.appendChild(selectLab);

  for (const [label, checked] of [["All", true], ["None", false]]) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.style.cssText = "font-size:10px;padding:2px 7px;line-height:1.4;";
    btn.addEventListener("click", () => {
      for (const c of chks) c.checked = checked;
    });
    group.appendChild(btn);
  }
  h.appendChild(group);
  return section;
}

function buildRandomizerTab(container) {
  randParams.length = 0; // rebuild-safe

  // Randomize button — selection is per-section (see makeSectionWithToggles)
  const header = document.createElement("div");
  header.style.cssText = "padding:10px 16px;display:flex;gap:8px;align-items:center;";
  const randBtn = document.createElement("button");
  randBtn.textContent = "Randomize";
  randBtn.style.cssText = "background:var(--accent);color:#fff;flex:0 0 auto;";
  header.appendChild(randBtn);
  container.appendChild(header);

  // Two columns: Boids controls on the left, Style controls on the right.
  const cols = document.createElement("div");
  cols.style.cssText = "display:flex;gap:12px;align-items:flex-start;padding:0 16px;";
  const colByTab = new Map();
  for (const tab of RAND_TABS) {
    const col = document.createElement("div");
    col.style.cssText = "flex:1 1 0;min-width:0;";
    const cap = document.createElement("div");
    cap.textContent = tab.charAt(0).toUpperCase() + tab.slice(1);
    cap.style.cssText = "font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;opacity:0.6;padding:4px 2px 8px;";
    col.appendChild(cap);
    colByTab.set(tab, col);
    cols.appendChild(col);
  }
  container.appendChild(cols);

  // Walk each randomizable tab's sections in order, one toggle row per control.
  // A section's `enableKey` is a real boolean parameter that simply lives in
  // the header instead of a row — surface it here so moving it out of `rows`
  // didn't quietly drop it from the randomizer.
  const sections = CONTROLS.filter(s => RAND_TABS.includes(s.tab)).map(s =>
    s.enableKey
      ? { ...s, rows: [{ label: "Show", key: s.enableKey, type: "checkbox" }, ...s.rows] }
      : s
  );
  for (const section of sections) {
    const col = colByTab.get(section.tab);
    let headerAdded = false;
    // Filled as rows are built below; the All/None handlers close over it, so
    // they see the complete list by the time anyone can click them.
    const sectionChks = [];
    for (const row of section.rows) {
      if (!RAND_TYPES.includes(row.type)) continue;
      if (!headerAdded) {
        col.appendChild(makeSectionWithToggles(section.title, sectionChks));
        headerAdded = true;
      }
      const lastSection = col.lastElementChild;

      const wrapper = document.createElement("div");
      wrapper.style.cssText = "display:flex;align-items:center;gap:10px;padding:8px 16px;border-top:1px solid var(--separator);";

      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.style.accentColor = "var(--accent)";

      const lab = document.createElement("label");
      lab.textContent = row.label;
      lab.style.cssText = "font-size:13px;flex:1;cursor:pointer;";
      lab.addEventListener("click", () => { chk.checked = !chk.checked; });

      wrapper.appendChild(chk);
      wrapper.appendChild(lab);
      lastSection.appendChild(wrapper);

      sectionChks.push(chk);
      randParams.push({
        type: row.type, key: row.key,
        min: row.min, max: row.max, step: row.step,
        rgbKeys: row.rgbKeys, alphaKey: row.alphaKey,
        chk,
      });
    }
  }

  randBtn.addEventListener("click", () => {
    for (const p of randParams) {
      if (p.chk.checked) randomizeParam(p);
    }
  });
}

// ─── Startup camera gate ────────────────────────────────────────
// Nothing is running on the main page until a camera is chosen (see
// initCameraGate() in main.js), so hold the popup on the Camera tab and show
// why until the operator picks one. Releases permanently on first selection.
// Set CAMERA_GATE_ENABLED to false to disable the gate.
// NOTE: main.js has a matching CAMERA_GATE_ENABLED flag. Both must agree.
const CAMERA_GATE_ENABLED = false;

let cameraGateOpen = CAMERA_GATE_ENABLED;

// The camera source now lives in the setup panel, so the gate holds that panel
// open (and closeSettings() refuses while cameraGateOpen) instead of pinning
// the popup to a tab.
function updateCameraGate(select) {
  const banner = document.getElementById("camera-gate");
  if (!cameraGateOpen) return;
  if (select.value) {
    cameraGateOpen = false;
    document.body.classList.remove("camera-gated");
    if (banner) banner.remove();
    closeSettings();
    return;
  }
  document.body.classList.add("camera-gated");
  if (!banner) {
    const el = document.createElement("div");
    el.id = "camera-gate";
    el.className = "camera-gate";
    el.textContent = "Select a camera source to start — no camera is open yet.";
    const body = document.getElementById("settings-body");
    body.parentNode.insertBefore(el, body);
  }
  openSettings();
}

// ─── Setup side panel (cog) ─────────────────────────────────────
const settingsPanel = document.getElementById("settings-panel");
const settingsBackdrop = document.getElementById("settings-backdrop");
const settingsBtn = document.getElementById("settingsBtn");

function openSettings() {
  // Already open: don't re-focus. The gate calls this again on every `devices`
  // broadcast, which would yank focus out of the camera select mid-selection.
  if (!settingsPanel.hidden) return;
  settingsPanel.hidden = false;
  settingsBackdrop.classList.add("visible");
  settingsBtn.setAttribute("aria-expanded", "true");
  const first = settingsPanel.querySelector("select, input, button");
  if (first) first.focus();
}

function closeSettings() {
  // The camera gate holds the panel open until a source is chosen.
  if (cameraGateOpen) return;
  settingsPanel.hidden = true;
  settingsBackdrop.classList.remove("visible");
  settingsBtn.setAttribute("aria-expanded", "false");
}

settingsBtn.addEventListener("click", () => {
  settingsPanel.hidden ? openSettings() : closeSettings();
});
settingsBackdrop.addEventListener("click", closeSettings);
document.getElementById("settingsClose").addEventListener("click", closeSettings);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !settingsPanel.hidden) closeSettings();
});

function switchTab(tabId) {
  activeTab = tabId;
  for (const [id, container] of tabContainers) {
    container.style.display = id === tabId ? "" : "none";
  }
  const btns = document.querySelectorAll(".tab-btn");
  for (const btn of btns) {
    btn.classList.toggle("active", btn.dataset.tab === tabId);
  }
}

buildUI();

// Gate is up from the first paint, before the device list has even arrived.
{
  const camUI = inputsByKey.get("cameraDeviceId");
  if (camUI) updateCameraGate(camUI.input);
}

// Channel logic
function sendHello() { chan.postMessage({ type: "hello" }); }
function sendSet(key, value) {
  chan.postMessage({ type: "set", key, value });
  if (MODEL_KEYS.has(key)) { lastState[key] = value; updateModelViz(); }
}

// ── Scene slew engine ──────────────────────────────────────────────
const slewTargets = new Map();
let slewRAF = null;

function startSlew(targets) {
  const now = performance.now();
  for (const [key, toVal] of targets.entries()) {
    const ui = inputsByKey.get(key);
    // Model-viz keys (boid↔boid / boid↔body) have no DOM row — fall back to
    // lastState so import slews from the live value instead of from zero.
    // Range rows report their true value via getValue() — the slider
    // itself is clamped, and slewing from its end stop would jump.
    const fromVal = ui ? (ui.getValue ? ui.getValue() : parseFloat(ui.input.value))
      : (lastState[key] !== undefined ? +lastState[key] : 0);
    if (isNaN(fromVal) || fromVal === toVal) {
      if (ui) ui.setValue(toVal);
      sendSet(key, toVal);
      continue;
    }
    slewTargets.set(key, {
      from: fromVal, to: toVal,
      startTime: now, duration: SCENE_SLEW_DURATION * 1000,
    });
  }
  if (slewTargets.size > 0 && !slewRAF) {
    slewRAF = requestAnimationFrame(slewTick);
  }
}

function slewTick(timestamp) {
  for (const [key, s] of slewTargets.entries()) {
    // rAF's timestamp can predate the performance.now() taken in startSlew;
    // clamp at 0 or the first frame overshoots past `from`.
    const t = Math.max(0, Math.min((timestamp - s.startTime) / s.duration, 1));
    const eased = 1 - Math.pow(1 - t, 3);
    // Exact target on the last frame (see slewTick in channel.js)
    const current = t >= 1 ? s.to : s.from + (s.to - s.from) * eased;
    const ui = inputsByKey.get(key);
    if (ui) ui.setValue(current);
    sendSet(key, current);
    if (t >= 1) slewTargets.delete(key);
  }
  if (slewTargets.size > 0) {
    slewRAF = requestAnimationFrame(slewTick);
  } else {
    slewRAF = null;
  }
}

chan.onmessage = (e) => {
  const msg = e.data || {};
  if (!msg.type) return;
  if (msg.type === "snapshot" || msg.type === "state") {
    statusEl.textContent = "Connected";
    applyStateToUI(msg.state);
  } else if (msg.type === "devices") {
    const ui = inputsByKey.get("cameraDeviceId");
    if (ui && ui.setOptions) {
      ui.setOptions(msg.devices, msg.currentDeviceId);
    }
  } else if (msg.type === "phone-layout") {
    // Relayed by channel.js from the phone; exported as the scene's _phone
    phoneLayout = msg.layout || null;
  } else if (msg.type === "display-info") {
    displayReports.set(`${msg.ip || msg.host}|${msg.role}`, msg);
    renderDisplayReports();
  }
};

function toggleChildren(parentKey, visible) {
  const children = childKeysOf.get(parentKey);
  if (!children) return;
  for (const ck of children) {
    const w = wrappersByKey.get(ck);
    if (w) w.style.display = visible ? "" : "none";
  }
}

function applyStateToUI(state) {
  if (!state) return;
  lastState = Object.assign(lastState, state);
  // Sync header Rec button
  if (state.recordingMode !== undefined) {
    setRecState(!!state.recordingMode);
  }
  for (const [key, ui] of inputsByKey.entries()) {
    if (ui.rgbKeys) {
      const r = state[ui.rgbKeys[0]], g = state[ui.rgbKeys[1]], b = state[ui.rgbKeys[2]];
      if (r !== undefined && g !== undefined && b !== undefined) {
        ui.setValue(rgbToHex(r, g, b));
      }
    } else if (Object.prototype.hasOwnProperty.call(state, key)) {
      ui.setValue(state[key]);
    }
  }
  // Update sub-row visibility based on parent checkbox state
  for (const [parentKey, children] of childKeysOf.entries()) {
    const parentVal = state[parentKey];
    const visible = !!parentVal;
    for (const ck of children) {
      const w = wrappersByKey.get(ck);
      if (w) w.style.display = visible ? "" : "none";
    }
  }
  // Sync skeleton nodes + keypoint detail groups from state.
  for (let i = 0; i < 17; i++) {
    if (Object.prototype.hasOwnProperty.call(state, `kp${i}`)) {
      setKpActive(i, !!state[`kp${i}`]);
    }
  }
  updateModelViz();
}

// Manual sync button
function syncHandler() { chan.postMessage({ type: "sync" }); }
syncBtn.addEventListener("click", syncHandler);

// Rec toggle button (header bar — not a tab control)
const recBtn = document.getElementById("recBtn");
let recState = false;

const recModal = document.getElementById("rec-modal");
const recFilenameInput = document.getElementById("rec-filename");

// While recording, the button shows elapsed time ("● 01:24") instead of "Rec".
let recTimer = null;
let recStartTime = 0;

function updateRecLabel() {
  const s = Math.floor((Date.now() - recStartTime) / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  recBtn.textContent = `● ${mm}:${ss}`;
}

function setRecState(active) {
  recState = active;
  recBtn.classList.toggle("rec-active", active);
  if (active && !recTimer) {
    recStartTime = Date.now();
    updateRecLabel();
    recTimer = setInterval(updateRecLabel, 1000);
  } else if (!active && recTimer) {
    clearInterval(recTimer);
    recTimer = null;
    recBtn.textContent = "Rec";
  }
}

function recDefaultName() {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `flock-${ts}`;
}

function openRecModal() {
  recFilenameInput.value = "";
  recFilenameInput.placeholder = recDefaultName();
  recModal.classList.add("visible");
  recFilenameInput.focus();
}

function closeRecModal() {
  recModal.classList.remove("visible");
}

// Send the chosen name so main.js downloads the (already-stopped) recording.
function submitRecName(name) {
  closeRecModal();
  chan.postMessage({ type: "set-rec-filename", filename: name });
}

recBtn.addEventListener("click", () => {
  if (!recState) {
    // First press: start recording immediately.
    setRecState(true);
    sendSet("recordingMode", true);
  } else {
    // Second press: stop recording now, then ask what to name the file.
    // main.js holds the finished blob and only downloads once a name arrives.
    setRecState(false);
    sendSet("recordingMode", false);
    openRecModal();
  }
});

// Keyboard tab switching: digits 1–7 select tabs in display order.
document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
  const idx = parseInt(e.key, 10) - 1;
  if (idx >= 0 && idx < TABS.length) switchTab(TABS[idx].id);
});

recFilenameInput.addEventListener("keydown", (e) => {
  // Enter → typed name (or default); Esc → default name. Either way the
  // finished recording is saved — it's already stopped and can't be un-stopped.
  if (e.key === "Enter") {
    e.preventDefault();
    submitRecName(recFilenameInput.value.trim() || recFilenameInput.placeholder);
  }
  if (e.key === "Escape") {
    e.preventDefault();
    submitRecName(recFilenameInput.placeholder);
  }
});

// Click outside the dialog saves with the default name (matches Esc).
recModal.addEventListener("click", (e) => {
  if (e.target === recModal) submitRecName(recFilenameInput.placeholder);
});

// Export / Import
const exportBtn = document.getElementById("exportBtn");
const importBtn = document.getElementById("importBtn");
const importFile = document.getElementById("importFile");

function getDefaultFilename() {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-ccl25-controls.json`;
}

// What a scene carries is structural: everything in the TABS is performance
// content and travels with the scene; everything in the Setup panel is rig
// configuration and never does. No flags, no key lists — a parameter's home
// decides it.
// NOTE: channel.js carries a matching hardcoded list for scenes loaded via the
// scene manager. Keep the two in sync.
const SCENE_EXCLUDED_KEYS = (() => {
  const set = new Set();
  for (const sec of CONTROLS) {
    if (sec.tab !== "settings") continue;
    for (const row of sec.rows) if (row.key) set.add(row.key);
  }
  return set;
})();

// The phone controller's mapping (slots, custom ranges, map sets A–F). Lives
// on the phone; channel.js relays every change here so an export can carry it
// as `_phone`. The leading underscore keeps it out of every state path —
// import and the scene slew both skip `_` keys.
let phoneLayout = null;

function collectCurrentState() {
  const obj = { _version: 4 };
  for (const [key, ui] of inputsByKey.entries()) {
    if (SCENE_EXCLUDED_KEYS.has(key)) continue;
    if (ui.input.type === "checkbox") {
      obj[key] = ui.input.checked;
    } else if (ui.input.type === "color") {
      obj[key] = ui.input.value;
      if (ui.rgbKeys) {
        const [r, g, b] = hexToRgb(ui.input.value);
        obj[ui.rgbKeys[0]] = r;
        obj[ui.rgbKeys[1]] = g;
        obj[ui.rgbKeys[2]] = b;
      }
    } else {
      // getValue(), not input.value: values typed past the slider's range
      // (shown orange) must export as typed, not clamped to the end stop.
      obj[key] = ui.getValue ? ui.getValue() : parseFloat(ui.input.value);
    }
  }
  // Keypoints are only partly represented above: the on/off flags are SVG
  // skeleton nodes (never in inputsByKey), and an inactive keypoint's
  // weight/radius rows are removed from inputsByKey by removeKpGroup(). Fill
  // the gaps from lastState so a scene captures the whole skeleton, not just
  // whichever joints happen to be selected right now.
  for (let i = 0; i < 17; i++) {
    for (const k of [`kp${i}`, `kp${i}Weight`, `kp${i}Radius`]) {
      if (obj[k] === undefined && lastState[k] !== undefined) obj[k] = lastState[k];
    }
  }
  // The Boid↔Boid and Boid↔Body interaction radii/weights are edited in the
  // live model diagram ("Controls" section, buildModelViz) — their CONTROLS
  // sections are `hidden` (Randomizer-only) and never build DOM rows, so they
  // never appear in inputsByKey and the loop above can't see them. Their live
  // values are tracked in lastState; fill the gaps so a scene carries the
  // whole simulation.
  for (const key of MODEL_KEYS) {
    if (obj[key] === undefined && lastState[key] !== undefined) obj[key] = lastState[key];
  }
  return obj;
}

document.getElementById("scenesBtn").addEventListener("click", () => {
  const url = new URL("scenes.html", location.href);
  window.open(url.href, "scene-manager", "width=520,height=600");
});

const exportModal = document.getElementById("export-modal");
const exportFilenameInput = document.getElementById("export-filename");

function openExportModal() {
  exportFilenameInput.value = "";
  exportFilenameInput.placeholder = getDefaultFilename().replace(/\.json$/, "");
  exportModal.classList.add("visible");
  exportFilenameInput.focus();
}

function closeExportModal() {
  exportModal.classList.remove("visible");
}

function doExport() {
  const name = exportFilenameInput.value.trim() || exportFilenameInput.placeholder;
  const filename = name.endsWith(".json") ? name : name + ".json";
  closeExportModal();
  const data = collectCurrentState();
  if (phoneLayout) data._phone = phoneLayout;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

exportBtn.addEventListener("click", openExportModal);

exportFilenameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); doExport(); }
  if (e.key === "Escape") { e.preventDefault(); closeExportModal(); }
});

exportModal.addEventListener("click", (e) => {
  if (e.target === exportModal) closeExportModal();
});

importBtn.addEventListener("click", () => importFile.click());

importFile.addEventListener("change", () => {
  const file = importFile.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try {
      data = JSON.parse(reader.result);
    } catch (err) {
      alert("Invalid JSON file: " + err.message);
      return;
    }
    // Nothing is applied yet — the modal decides which parameters load
    openImportModal(file.name.replace(/\.json$/i, ""), data);
  };
  reader.readAsText(file);
  importFile.value = "";
});

// Apply a scene object. Receives only the keys the import modal let through.
function applyImportedScene(data) {
  // Collect numeric keys for slewing, apply others instantly
  const slewQueue = new Map();
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith('_')) continue;
    // Older files may carry rig settings — ignore them (SCENE_EXCLUDED_KEYS).
    if (SCENE_EXCLUDED_KEYS.has(key)) continue;
    if (inputsByKey.has(key)) {
      const ui = inputsByKey.get(key);
      if (ui.rgbKeys) {
        const [r, g, b] = hexToRgb(value);
        slewQueue.set(ui.rgbKeys[0], r);
        slewQueue.set(ui.rgbKeys[1], g);
        slewQueue.set(ui.rgbKeys[2], b);
        ui.setValue(value);
      } else if (ui.input.type === "checkbox") {
        ui.setValue(value);
        sendSet(key, value);
      } else if (ui.input.type === "color") {
        ui.setValue(value);
        sendSet(key, value);
      } else if (ui.input.type === "select-one") {
        ui.setValue(value);
        sendSet(key, value);
      } else {
        slewQueue.set(key, parseFloat(value));
      }
    } else {
      const num = parseFloat(value);
      if (!isNaN(num)) {
        slewQueue.set(key, num);
      } else {
        sendSet(key, value);
      }
    }
  }
  if (slewQueue.size > 0) startSlew(slewQueue);
  // Restore the phone's mapping too (channel.js forwards it over WS)
  if (data._phone) chan.postMessage({ type: "phone-layout-apply", layout: data._phone });
}

// ─── Import modal: choose which parameters of a scene to load ─────────
// Scene keys grouped exactly like the panel: tab → section → item. An item
// is one control and owns every scene key behind it (a colour row owns its
// hex key AND its R/G/B keys), so ticking it loads the control as a whole.
// Built from CONTROLS, so a new row shows up here with no extra wiring.
// Setup ("settings") sections are absent: scenes never load rig settings.
const SCENE_SCHEMA = (() => {
  const tabs = [];

  // Pose has no CONTROLS rows — it is the interactive skeleton
  tabs.push({
    id: "pose",
    label: "Pose",
    sections: KP_NAMES.map((name, i) => ({
      // "leftShoulder" → "Left shoulder"
      title: name.replace(/([A-Z])/g, " $1").toLowerCase().replace(/^./, c => c.toUpperCase()),
      items: [
        { label: "Active", keys: [`kp${i}`] },
        { label: "Weight", keys: [`kp${i}Weight`] },
        { label: "Radius", keys: [`kp${i}Radius`] },
      ],
    })),
  });

  for (const tab of TABS) {
    if (tab.id === "pose" || tab.id === "rand") continue;
    const sections = [];
    for (const sec of CONTROLS) {
      if (sec.tab !== tab.id) continue;
      const labelOf = new Map(sec.rows.map(r => [r.key, r.label]));
      const items = [];
      // A section header switch is a real parameter too
      if (sec.enableKey) items.push({ label: "Visible", keys: [sec.enableKey] });
      for (const row of sec.rows) {
        if (row.local) continue;
        items.push({
          // Child rows repeat labels ("Color" ×3 in Interaction Radii)
          label: row.parent ? `${labelOf.get(row.parent) || row.parent} · ${row.label}` : row.label,
          keys: [row.key, ...(row.rgbKeys || [])],
        });
      }
      sections.push({ title: sec.title, items });
    }
    tabs.push({ id: tab.id, label: tab.label, sections });
  }
  return tabs;
})();

const SCHEMA_KEYS = new Set(
  SCENE_SCHEMA.flatMap(t => t.sections.flatMap(s => s.items.flatMap(i => i.keys)))
);

const importModal = document.getElementById("import-modal");
const importTitle = document.getElementById("import-title");
const importTree = document.getElementById("import-tree");
const importCount = document.getElementById("import-count");
const importLoadBtn = document.getElementById("import-load");
let importData = null;   // parsed scene awaiting confirmation
let importItems = [];    // { keys, input } for every item checkbox in the modal
// Rebuilt on every open, so the per-group listeners on it are dropped with
// it instead of piling up on #import-tree across imports.
let importRoot = null;
const fireImportChange = () => importRoot.dispatchEvent(new Event("import-change", { bubbles: true }));

// The scene's own value, shown beside each parameter
function previewValue(data, keys) {
  const v = data[keys[0]];
  const span = document.createElement("span");
  span.className = "import-val";
  if (typeof v === "boolean") {
    span.textContent = v ? "on" : "off";
  } else if (typeof v === "string" && v.startsWith("#")) {
    const sw = document.createElement("i");
    sw.className = "import-swatch";
    sw.style.background = v;
    span.append(sw, v);
  } else if (typeof v === "number" || (typeof v === "string" && isFinite(parseFloat(v)))) {
    span.textContent = String(+(+v).toFixed(3));
  } else if (keys[0] === "_phone" && v && typeof v === "object") {
    const n = (a) => (Array.isArray(a) ? a.length : 0);
    span.textContent = `${n(v.sliders)} sliders \u00b7 ${n(v.toggles)} toggles \u00b7 ${n(v.scenes)} map sets`;
  } else if (v && typeof v === "object") {
    span.textContent = "";
  } else {
    span.textContent = String(v);
  }
  return span;
}

// One tri-state checkbox controlling a set of item checkboxes
function bindGroup(groupInput, members) {
  const sync = () => {
    const on = members.filter(m => m.input.checked).length;
    groupInput.checked = on === members.length;
    groupInput.indeterminate = on > 0 && on < members.length;
  };
  groupInput.addEventListener("change", () => {
    for (const m of members) m.input.checked = groupInput.checked;
    fireImportChange();
  });
  importRoot.addEventListener("import-change", sync);
  sync();
}

function makeImportHead(cls, title, members, collapsible) {
  const head = document.createElement("div");
  head.className = cls;
  const lab = document.createElement("label");
  const box = document.createElement("input");
  box.type = "checkbox";
  const name = document.createElement("span");
  name.textContent = title;
  lab.append(box, name);
  const count = document.createElement("span");
  count.className = "import-n";
  importRoot.addEventListener("import-change", () => {
    count.textContent = `${members.filter(m => m.input.checked).length}/${members.length}`;
  });
  head.append(lab, count);
  let body = null;
  if (collapsible) {
    const tog = document.createElement("button");
    tog.type = "button";
    tog.className = "import-toggle";
    tog.setAttribute("aria-label", `Show ${title} parameters`);
    tog.setAttribute("aria-expanded", "false");
    tog.textContent = "›";
    head.append(tog);
    tog.addEventListener("click", () => {
      const open = tog.getAttribute("aria-expanded") !== "true";
      tog.setAttribute("aria-expanded", String(open));
      if (body) body.hidden = !open;
    });
  }
  bindGroup(box, members);
  return { head, setBody: (b) => { body = b; if (collapsible) b.hidden = true; } };
}

function makeImportItem(label, keys, data) {
  const row = document.createElement("label");
  row.className = "import-item";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = true;
  input.addEventListener("change", fireImportChange);
  const name = document.createElement("span");
  name.className = "import-name";
  name.textContent = label;
  row.append(input, name, previewValue(data, keys));
  const item = { keys, input };
  importItems.push(item);
  return { row, item };
}

function openImportModal(name, data) {
  importData = data;
  importItems = [];
  importRoot = document.createElement("div");
  importTree.replaceChildren(importRoot);
  importTitle.textContent = `Import “${name}”`;
  const has = (k) => Object.prototype.hasOwnProperty.call(data, k);

  const addTab = (label, sections) => {
    const tabMembers = [];
    const tabEl = document.createElement("div");
    tabEl.className = "import-tab";
    const tabBody = document.createElement("div");
    for (const sec of sections) {
      const secMembers = [];
      const secBody = document.createElement("div");
      secBody.className = "import-items";
      for (const it of sec.items) {
        const { row, item } = makeImportItem(it.label, it.keys, data);
        secBody.append(row);
        secMembers.push(item);
      }
      if (sec.flat) {
        // Single-item groups (phone layout) need no section level
        tabBody.append(secBody);
      } else {
        const { head, setBody } = makeImportHead("import-sec", sec.title, secMembers, true);
        setBody(secBody);
        tabBody.append(head, secBody);
      }
      tabMembers.push(...secMembers);
    }
    // Tabs start collapsed too: the modal opens as a one-line-per-tab
    // overview instead of 17 Pose joints pushing everything else off-screen
    const { head, setBody } = makeImportHead("import-tab-head", label, tabMembers, true);
    setBody(tabBody);
    tabEl.append(head, tabBody);
    importRoot.append(tabEl);
  };

  // Panel tabs — only the parameters this scene actually carries
  for (const tab of SCENE_SCHEMA) {
    const sections = tab.sections
      .map(s => ({ title: s.title, items: s.items
        .map(i => ({ label: i.label, keys: i.keys.filter(has) }))
        .filter(i => i.keys.length) }))
      .filter(s => s.items.length);
    if (sections.length) addTab(tab.label, sections);
  }

  if (data._phone && typeof data._phone === "object") {
    addTab("Phone controller", [{ flat: true, items: [{ label: "Slider, toggle & map set layout", keys: ["_phone"] }] }]);
  }

  // Keys no control owns (older or hand-edited files). Listed rather than
  // loaded or dropped silently. Rig settings are never loaded, so skip them.
  const other = Object.keys(data).filter(k =>
    !k.startsWith("_") && !SCHEMA_KEYS.has(k) && !SCENE_EXCLUDED_KEYS.has(k));
  if (other.length) {
    addTab("Other", [{ title: "Not in the panel", items: other.map(k => ({ label: k, keys: [k] })) }]);
  }

  if (importItems.length === 0) {
    alert("This file has no scene parameters to load.");
    importData = null;
    return;
  }
  fireImportChange();
  importModal.classList.add("visible");
  importLoadBtn.focus();
}

function closeImportModal() {
  importModal.classList.remove("visible");
  importData = null;
  importItems = [];
}

function confirmImport() {
  if (!importData) return;
  const picked = {};
  for (const { keys, input } of importItems) {
    if (!input.checked) continue;
    for (const k of keys) picked[k] = importData[k];
  }
  closeImportModal();
  applyImportedScene(picked);
}

importTree.addEventListener("import-change", () => {
  const n = importItems.filter(i => i.input.checked).length;
  importCount.textContent = `${n} of ${importItems.length} selected`;
  importLoadBtn.disabled = n === 0;
  importLoadBtn.textContent = n === importItems.length ? "Load all" : `Load ${n}`;
});

document.getElementById("import-all").addEventListener("click", () => {
  for (const i of importItems) i.input.checked = true;
  fireImportChange();
});
document.getElementById("import-none").addEventListener("click", () => {
  for (const i of importItems) i.input.checked = false;
  fireImportChange();
});
document.getElementById("import-cancel").addEventListener("click", closeImportModal);
importLoadBtn.addEventListener("click", confirmImport);
importModal.addEventListener("click", (e) => {
  if (e.target === importModal) closeImportModal();
});
importModal.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { e.preventDefault(); closeImportModal(); }
  // Enter loads — except on a focused button, which handles its own Enter
  if (e.key === "Enter" && e.target.tagName !== "BUTTON") { e.preventDefault(); confirmImport(); }
});

// Kick things off
statusEl.textContent = "Connecting\u2026";
sendHello();
chan.postMessage({ type: "request-devices" });

// Role-aware header buttons (master/slave)
(function initRole() {
  fetch('/api/role')
    .then(r => r.json())
    .then(role => {
      const headerDiv = document.querySelector('header > div:first-child');
      if (role.role === 'master') {
        // Add role badge
        const badge = document.createElement('span');
        badge.className = 'role-badge master';
        badge.textContent = 'Master';
        headerDiv.appendChild(badge);
        // Replace Sync button
        syncBtn.textContent = 'Sync Slaves';
        syncBtn.title = 'Push current state to all slave machines';
        syncBtn.removeEventListener('click', syncHandler);
        syncBtn.addEventListener('click', () => {
          chan.postMessage({ type: 'sync-slaves' });
        });
      } else if (role.role === 'slave') {
        // Add role badge
        const badge = document.createElement('span');
        badge.className = 'role-badge slave';
        badge.textContent = 'Slave';
        headerDiv.appendChild(badge);
        // Replace Sync button
        syncBtn.textContent = 'Sync to Main';
        syncBtn.title = 'Pull state from the master machine';
        syncBtn.removeEventListener('click', syncHandler);
        syncBtn.addEventListener('click', () => {
          chan.postMessage({ type: 'sync-to-master' });
        });
      }
    })
    .catch(() => {});
})();

// QR code for phone controller URL
(function initQR() {
  fetch('/api/phone-url')
    .then(r => r.json())
    .then(data => {
      const section = document.getElementById('qr-section');
      const canvas = document.getElementById('qr-canvas');
      const urlEl = document.getElementById('qr-url');

      urlEl.textContent = data.url;
      section.style.display = '';

      // Generate QR using qrcode-generator library
      const qr = qrcode(0, 'M');
      qr.addData(data.url);
      qr.make();

      const moduleCount = qr.getModuleCount();
      const size = canvas.width;
      const cellSize = size / moduleCount;
      const ctx = canvas.getContext('2d');

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = '#1c1c1e';

      for (let row = 0; row < moduleCount; row++) {
        for (let col = 0; col < moduleCount; col++) {
          if (qr.isDark(row, col)) {
            ctx.fillRect(col * cellSize, row * cellSize, cellSize + 0.5, cellSize + 0.5);
          }
        }
      }
    })
    .catch(() => {
      // Not running via server.js (e.g. npx serve) — hide QR section
    });
})();
