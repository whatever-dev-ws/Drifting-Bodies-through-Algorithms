# Flocking System — Full Documentation

*Interactive body-driven flocking installation. Phone-control variant.*

---

## Table of Contents

1. [System Logic](#1-system-logic)
2. [Boids](#2-boids)
3. [Body Tracking](#3-body-tracking)
4. [How Everything Works Together](#4-how-everything-works-together)
5. [Control Interfaces](#5-control-interfaces)
6. [Visual Styles & Properties](#6-visual-styles--properties)
7. [Tech Stack](#7-tech-stack)
8. [File Map](#8-file-map)
9. [Running the System](#9-running-the-system)

---

## 1. System Logic

### The idea, abstracted from technology

The system is a **live-behaviour instrument**. A crowd of simple autonomous agents (*boids*) moves on a screen. The agents obey three classic rules relative to each other, and the same three rules relative to a second class of agent: points on the bodies of the people standing in front of the camera.

There is no scripting, no timeline, no keyframes. What appears on screen is emergent — the whole visual result comes from the interaction of a set of numeric parameters with the live movement of real bodies. The operator does not draw; the operator *tunes the physics* and lets the people in the room animate it.

### The three actors

| Actor | Description |
|---|---|
| **Boid** | A moving point with position, velocity, acceleration, a max speed and a max steering force. It has no memory, no goal, no awareness beyond a radius. |
| **Body agent** | A point extracted from a tracked human skeleton (a wrist, a nose, an ankle). It has a position and a velocity derived from how the joint moved between frames. It is *not* simulated — it is observed. |
| **Operator** | Whoever moves the sliders. Changes the rules of the world in real time, not the contents of it. |

### The core loop

```
camera frame
  → pose model → skeletons → active keypoints → body agents (x, y, vx, vy, weight, radius)
      ↓
  boids read neighbours (other boids) + body agents
      ↓
  each computes separation / alignment / cohesion forces for both relationships
      ↓
  forces sum into acceleration → velocity → position
      ↓
  render
```

The asymmetry is the point: **boids react to bodies; bodies never react to boids.** People are a moving field of attractors/repellers. This is what makes the piece feel responsive — the crowd of dots visibly obeys you without you ever touching an interface.

### Why the parameters are signed

Every weight in the system runs from **−6 to +6**. Negative weights invert the rule:

- Negative separation → boids **seek** collision, collapse into knots.
- Negative cohesion → boids **flee** their local centre of mass, explode outward.
- Negative alignment → boids steer *against* the local average heading, producing turbulence and counter-currents.
- Negative body-cohesion → people **repel** the swarm instead of attracting it, carving voids in the shape of their bodies.

Most of the expressive range of the installation lives in these sign flips. A "well-behaved flock" is only one small region of parameter space.

### Two independent relationship families

The parameter set is deliberately mirrored:

|                | Boid ↔ Boid | Boid ↔ Body |
|---|---|---|
| Separation radius / weight | ✅ | ✅ |
| Alignment radius / weight  | ✅ | ✅ |
| Cohesion radius / weight   | ✅ | ✅ |
| Group radii multiplier     | `boidRadiiMult` | `bodyRadiiMult` |
| Group weights multiplier   | `boidWeightsMult` | `bodyWeightsMult` |

The two families are tuned independently, so you can have a tightly-flocking swarm that ignores people, a loose gas violently attracted to hands, or anything between. The group multipliers exist as macro controls: one slider scales all three radii or all three weights of a family at once — the fastest way to make an expressive move on a phone with only six sliders.

---

## 2. Boids

### What a boid is

```js
{
  position:     { x, y },
  velocity:     { x, y },      // random initial direction, speed 2–4
  acceleration: { x, y },      // reset to zero every frame
  baseMaxForce: 0.05,          // steering ceiling before globalForceMult
  maxForce:     0.05,          // = baseMaxForce * globalForceMult
  maxSpeed:     3,             // = globalMaxSpeed
  localCOM:     { x, y },      // last computed local centre of mass
  _forceMags:   Float32Array(7) // per-force magnitudes, for mood colouring
}
```

Population is maintained by trimming or appending: raising `boidCount` spawns new boids at random positions, lowering it truncates the array. Range is 1 – 10 000.

### The steering model

All six forces use the same Reynolds steering primitive:

```
desired = normalize(target_vector) * maxSpeed
steer   = desired − velocity
steer   = limit(steer, maxForce)
```

`maxForce` is the hard authority ceiling — how sharply a boid can turn. `maxSpeed` is the terminal velocity. The ratio between them determines the *character* of the motion: high force / low speed reads as nervous and insectile; low force / high speed reads as heavy and ballistic.

### Boid ↔ Boid: the three rules

Computed in **one fused pass** over neighbours — a single distance calculation per neighbour instead of three separate loops.

**Separation** — steer away from close neighbours. The repulsion is inverse-square weighted, so a neighbour at half the distance pushes four times harder:

```js
sepX += (-dx / d) / d;   // normalized direction ÷ distance
```

**Alignment** — steer toward the average velocity of neighbours inside `alignmentRadius`. Produces shoals, currents, laminar flow.

**Cohesion** — steer toward the average *position* of neighbours inside `cohesionRadius`. This averaged position is stored as `localCOM` and is what the "centre-of-mass line" overlay draws.

Each radius is independent and each is scaled by `boidRadiiMult`. The relationship between the three radii is what shapes the flock's texture:

- `sep > ali ≈ coh` → dispersed, gas-like, individual dots
- `coh > sep` → dense pulsing clots
- `ali` large, `sep`/`coh` small → parallel streams, no clustering

### Neighbour search

Naïve flocking is O(n²). This system uses a **spatial hash grid** (`spatial-grid.js`):

- Cell size is re-derived each frame as `max(sep, ali, coh) × boidRadiiMult`, floored at 20 px — the grid always matches the largest query radius, so a neighbour query touches at most a 3×3 cell block.
- Cell key is a hash: `(gx * 73856093) ^ (gy * 19349663)` — no allocation, no 2D array to resize on canvas resize.
- Output array is reused across queries (`this._out`), so neighbour lookup is allocation-free.

On top of that, `maxNeighbours` (default 50, range 5–200) caps how many valid neighbours a single boid will process. This is a hard performance lever: it bounds the worst case in dense clusters, at the cost of slightly biased sampling (whichever neighbours the grid happened to return first).

### Edge behaviour

Boids do **not** wrap. A 100 px margin around the canvas applies a repulsive force that ramps linearly from 0 at the margin line to `maxForce × 5` at the wall. The result is a soft rebound — boids decelerate and turn rather than bouncing or teleporting. It reads as an invisible cushioned enclosure, which suits a projected installation where wrapping would break the illusion of a contained space.

### Integration

```js
velocity += acceleration * dt
velocity  = limit(velocity, maxSpeed)
position += velocity * dt
acceleration = 0
```

`dt` is `deltaTime / 16.667`, so behaviour is frame-rate independent — a dropped frame produces a larger step, not a slow-motion swarm.

### Mood: reading a boid's internal state

When `showMoodColoring` is on, each boid accumulates the magnitude of every force it received this frame into a 7-slot array, and the index of the **largest** one becomes its "mood":

| ID | Dominant force | Parameter | Default |
|---|---|---|---|
| 0 | Separation (boid) | `moodSepColor` | `#e34948` red |
| 1 | Alignment (boid) | `moodAliColor` | `#199e70` green |
| 2 | Cohesion (boid) | `moodCohColor` | `#4c9ae8` blue |
| 3 | Separation (body) | `moodBodySepColor` | `#d95926` orange |
| 4 | Alignment (body) | `moodBodyAliColor` | `#1ae5e5` cyan |
| 5 | Cohesion (body) | `moodBodyCohColor` | `#d55181` magenta |
| 6 | Edge avoidance | `moodEdgeColor` | `#999999` grey |

All seven are editable (Appearance → Mood Coloring); the defaults above are the shipped palette, not hardcoded values.

This turns the swarm into a live diagnostic of its own dynamics: you can see which rule is actually driving the picture at any moment, watch orange bloom around a hand, or discover that a "beautiful" configuration is in fact 90% edge avoidance.

---

## 3. Body Tracking

### The model

**MoveNet MultiPose Lightning**, run through TensorFlow.js `@tensorflow-models/pose-detection` on the **WebGPU** backend. Chosen for the combination of multi-person support and real-time speed — Lightning is the fast variant of MoveNet, and MultiPose detects up to 6 people in a single pass rather than requiring one inference per person.

Detection runs in its **own `requestAnimationFrame` loop**, fully decoupled from the render loop. Detection is inherently slower than 60 fps; decoupling means the boids never wait for the model. They keep flocking against the most recent pose data, and a stale frame degrades gracefully into slightly laggy body agents rather than a dropped frame rate.

### The 17 keypoints

MoveNet emits COCO-standard keypoints:

```
0 nose · 1 L eye · 2 R eye · 3 L ear · 4 R ear
5 L shoulder · 6 R shoulder · 7 L elbow · 8 R elbow
9 L wrist · 10 R wrist · 11 L hip · 12 R hip
13 L knee · 14 R knee · 15 L ankle · 16 R ankle
```

Default active set: **nose, left wrist, right wrist** — head and hands, the three joints a person intuitively uses to "reach into" the piece.

Each keypoint has three independent controls:

- `kpN` — **on/off**. Does this joint act as a body agent at all?
- `kpNWeight` — **influence multiplier**. Scales how strongly this joint's force contributes.
- `kpNRadius` — **reach multiplier**. Scales the interaction radii around this joint.

This is the choreographic layer. Turning on ankles with a large radius and low weight makes walking through the space push the swarm gently; turning on only wrists with high weight and small radius makes the hands into sharp precise tools. Different mappings of the same body produce completely different instruments.

### From pixels to agents

The pipeline in `pose-tfjs.js`:

1. **Detect** — `detector.estimatePoses(video)`, results truncated to `maxPoses` (1–6, keeps the most confident).
2. **Filter poses** — `minPoseScore` (model-level; changing it disposes and rebuilds the detector).
3. **Filter keypoints** — drop any keypoint below `kpConfidence`.
4. **Transform to canvas space** — video-to-canvas scale + offset, in *fit* (letterbox) or *fill* (crop) mode, plus optional horizontal mirror. Cached per frame and invalidated only when canvas size, video size, or fill mode changes.
5. **Smooth** — exponential moving average per keypoint: `cur += (new − cur) × kpSmoothing`. Model smoothing is explicitly disabled (`enableSmoothing: false`) so this stays under operator control. Low values = fluid but laggy; high values = responsive but jittery.
6. **Derive velocity** — `v = smoothed_now − smoothed_previous`. Previous positions are snapshotted *after* the simulation consumed them, so velocity spans the full inter-simulation interval rather than an arbitrary sub-frame delta.
7. **Pack** — into a flat `Float32Array`, stride 6:

```
[x, y, vx, vy, weightMult, radiusMult,  x, y, vx, vy, weightMult, radiusMult, ...]
```

A flat typed array rather than objects: it crosses the worker boundary cheaply and is read in a tight indexed loop with no property lookups.

### How bodies act on boids

`flockWithBody()` mirrors `flockWithBoids()` but with three differences:

1. **No spatial grid.** Body agents number at most 6 people × 17 keypoints = 102, usually far fewer. A linear scan is cheaper than maintaining a second grid.
2. **Per-agent radii.** Each agent carries its own `radiusMult`, so the effective radius is `baseRadius × bodyRadiiMult × kpRadiusMult` — computed inside the loop, per agent.
3. **Weighted averaging.** Contributions are summed weighted by `weightMult` and divided by the **sum of weights**, not the count. A high-weight wrist genuinely dominates a low-weight ankle rather than merely being one vote among many.

The keypoint *velocity* is what feeds body-alignment: a stationary hand has zero velocity and exerts no alignment force, while a swept arm drags the swarm along its direction of travel. Body alignment is therefore a **gesture-sensitive** force in a way body cohesion and separation are not.

### Behavioural signature

- **Body cohesion positive** → the swarm gathers on the person. Silhouette-drawing.
- **Body separation positive** → the person carves a hole. Negative-space portraiture.
- **Body alignment positive** → the swarm inherits the gesture's direction. Wake and slipstream effects.
- **Weights negative** → all of the above inverted.
- **Multiple people, high weights** → competing attractors, unstable equilibria, boids oscillating between bodies.

---

## 4. How Everything Works Together

### Thread and process topology

```
┌─────────────────────────────────────────────────────────────┐
│ Browser tab — index.html (main visualization)               │
│                                                             │
│  Main thread                    Web Worker                  │
│  ┌───────────────────────┐      ┌────────────────────────┐  │
│  │ p5 draw() @60fps      │─────▶│ boid-worker.js         │  │
│  │  · pack body agents   │ msg  │  · spatial grid rebuild│  │
│  │  · post to worker     │      │  · flockWithBoids      │  │
│  │  · render last result │◀─────│  · flockWithBody       │  │
│  │  · WebGL points       │ xfer │  · edge avoidance      │  │
│  │  · 2D overlay         │      │  · integrate           │  │
│  └───────────────────────┘      └────────────────────────┘  │
│           ▲                                                 │
│           │ rAF loop (independent)                          │
│  ┌────────┴──────────────┐                                  │
│  │ pose-tfjs.js          │                                  │
│  │  MoveNet on WebGPU    │                                  │
│  └───────────────────────┘                                  │
│           ▲                                                 │
│      getUserMedia (webcam)                                  │
└─────────────────────────────────────────────────────────────┘
        ▲                              ▲
        │ BroadcastChannel             │ WebSocket
        │ "flock-controls"             │
┌───────┴─────────┐            ┌───────┴──────────┐
│ controls.html   │            │ server.js relay  │
│ scenes.html     │            └───────┬──────────┘
└─────────────────┘                    │
                                ┌──────┴───────┐
                                │  phone.html  │
                                └──────────────┘
```

Three concurrent rates: **render ~60 Hz**, **simulation as fast as the worker completes**, **pose detection at model speed**. Nothing blocks anything else.

### One frame, in order

1. Recording-mode transitions checked; `MediaRecorder` started/stopped if changed.
2. WEBGL canvas cleared to `canvasBg` colour.
3. If the worker is **idle**: pack body agents, post a `simulate` message, then snapshot previous keypoints. Body agents are computed *only* on frames where they'll actually be sent — pose scaling and smoothing are skipped otherwise.
4. Render the **previous** frame's positions. One frame of lag, imperceptible at 60 fps, and it removes the stall that waiting for the worker would cause.
5. Grid analytics computed if any heatmap or flow-field is on.
6. 2D debug overlay drawn on its own canvas.
7. Performance overlay updated at ~4 Hz (not 60 Hz — avoids layout thrash from DOM text writes).

### The zero-copy transfer trick

Worker results come back as **transferable** `Float32Array` buffers. Transfer neuters the sender's copy, so the worker keeps **two buffer sets (A and B)** and alternates: while set A is in flight to the main thread, set B is being filled. No allocation per frame, no structured-clone copy of 10 000 positions.

State is also sent **dirty-flagged**: `msg.state` is attached only when something changed. The worker caches the last state it received. On a static frame, the message is just body agents plus canvas dimensions.

### State: single source of truth

`state.js` holds one flat object with every parameter. Everything else reads it and nothing else owns a duplicate.

`setKey(key, value)` performs typed coercion via key-set membership:

- `numKeys` → `+value`
- `roundKeys` → `Math.round(+value)` (counts, resolutions)
- `boolKeys` and `/^kp\d+$/` → boolean
- `/^kp\d+(Weight|Radius)$/` → float
- strings starting with `#` → stored verbatim as hex colours

This is why adding a parameter requires registering it in `state.js` as well as in the UI definitions — an unregistered key is silently dropped.

### Messaging protocol

All surfaces speak the same message vocabulary, and `handleMessage()` in `channel.js` handles them identically regardless of whether they arrived over BroadcastChannel (same-machine popups) or WebSocket (phone, other machines).

| Message | Direction | Effect |
|---|---|---|
| `hello` | control → main | Main replies with a full `snapshot` + camera device list |
| `set {key, value}` | control → main | Mutate one key, rebroadcast `state` to everyone |
| `sync` | control → main | Request a full `snapshot` |
| `state` / `snapshot` | main → all | Full state push |
| `load-scene {state}` | scenes → main | Begin an eased transition to a target state |
| `set-slew-duration` / `set-slew-curve` / `set-fade-transitions` | scenes → main | Configure transition behaviour |
| `switch-camera {deviceId}` | control → main | Swap webcam stream, re-enumerate devices |
| `request-devices` / `devices` | ↔ | Camera enumeration |
| `set-rec-filename` | control → main | Release a held recording for download |
| `fullscreen` / `camera-popup` | control → main | Trigger main-page actions |
| `sync-slaves` / `sync-to-master` | ↔ | Multi-machine synchronisation |

### Scene transitions (slew engine)

Scenes are full parameter snapshots stored as JSON. Loading one does **not** snap — `channel.js` runs an interpolation engine:

- Numeric keys are interpolated over `sceneSlewDuration` (default 2 s, 0–30 s).
- Booleans and colours switch immediately (there is no meaningful midpoint).
- Eight easing curves: `linear`, `ease-in`, `ease-out`, `ease-in-out`, `ease-out-cubic` (default), `ease-in-cubic`, `exponential`, `logarithmic`.
- **Fade transitions** (optional): because `boidCount` cannot be interpolated smoothly — spawning boids mid-transition makes them pop in at random positions — enabling this fades `boidAlpha` to 0 over the first half of the transition, swaps `boidCount` at the midpoint, and fades back in over the second half. The population change is hidden inside the fade.

Every slew tick rebroadcasts state, so the controls popup and phone sliders animate along with the visuals.

### Multi-machine: master / slave

`server.js` can run in three roles:

- **standalone** — one machine, relays between local browser clients and phone.
- **master** — additionally accepts `ws://<ip>:3000/slave-link` connections and relays state to every slave server.
- **slave** — connects upstream to a master and applies incoming state.

State flowing in over WebSocket with `source === 'ws'` is applied and forwarded to the local controls popup, but **not echoed back**, which prevents feedback loops. A heartbeat pings every 20 s and terminates unresponsive sockets.

This is the multi-projector path: several machines running identical parameters, each with its own camera and its own emergent swarm.

---

## 5. Control Interfaces

There are **four** control surfaces, all speaking the same protocol.

### 5.1 Controls popup (`controls.html` / `controls.js`)

Auto-opened by `index.html` at 520×720. The primary desk-side interface. UI is generated from a **declarative `CONTROLS` array** — each entry is a titled section with a `tab` and a list of typed rows (`range`, `checkbox`, `select`, `color`). Adding a parameter means adding a row object, not writing DOM code.

The window is split into **four tabs** (performance surface) and a **Setup side panel** behind the cog (rig configuration, set once and left alone). The split is the point: everything you touch mid-show is in a tab; everything you touch before the doors open is behind the cog.

**Four tabs** (`TABS` in `controls.js`):

| Tab | Contents |
|---|---|
| **Pose** | The interactive skeleton (below) — no flat keypoint list |
| **Boids** | Population (Boid Size, Boid Count, Max Neighbours, Max Speed, Steering Limit), Frame Repulsion (`edgeMargin`, `edgeStrength`), boid↔boid and boid↔body radii & weights with ★ group multipliers, live model diagram |
| **Appearance** | Merges the former Style and Visual tabs. Grouped by **subject**, not by control type — each drawable owns its visibility toggle and its styling in one section. Sections are ordered into labelled families by semantic closeness: **Boids & Canvas** (the Boids section, with Mood coloring nested inside it — mood only renders through the boid draw call, so it collapses with the Boids switch — then Canvas), **Body** (Skeleton, Keypoints), **Behaviour** (Interaction Radii, Center of Mass, Path Trail — what each boid perceives, where it is pulled, where it went), **Field Analysis** (Analysis Grid, Density Heatmap, Speed Heatmap, Velocity Flow) |
| **Rand** | Randomizer — flag any range/checkbox/colour control from the Boids and Appearance tabs (`RAND_TABS`, `RAND_TYPES`) and shuffle them |

**Setup panel** (cog button → `#settings-panel`; sections declared with `tab: "settings"`):

| Section | Contents |
|---|---|
| **Source** | Camera source select |
| **Webcam Display** | Show Video / Fill Canvas / Mirror |
| **Detection** | Min Pose Score, Input Resolution, Max Poses, KP Confidence, KP Smoothing |
| **Debug** | Performance Overlay — all that remained of the old Debug tab once the skeleton and keypoint toggles moved to Appearance. **Tooltips** — shows/hides the help text under controls in every tab. A preference of the controls window only: saved in this browser's localStorage, never sent to the main page or slaves, never written into exported scenes |

**Section `enableKey`.** An Appearance section may declare an `enableKey` (`showTriangle`, `showSkeleton`, `showActiveKeypoints`, `showDensityHeatmap`, …). It renders as a bare switch in the section header (no visible text — the section title names it, and it carries the title as its `aria-label`) that collapses the body when off. These keys gate *rendering only* — `showTriangle` skips the draw call while the simulation keeps running.

**Camera gate.** Behind `CAMERA_GATE_ENABLED` — **currently `false`**, and the flag is duplicated in both `controls.js:1364` and `main.js:15`; *both must agree*. When on, `updateCameraGate()` holds the Setup panel open with a banner ("Select a camera source to start — no camera is open yet"), adds `body.camera-gated` so nothing but the source select is actionable, and refuses `closeSettings()` until a camera is chosen. The gate holds the *panel*, not a tab — a consequence of the source select having moved out of the tab strip.

**Interactive skeleton (Pose tab).** Instead of a flat list of 17 checkboxes, keypoints are laid out as a clickable SVG body. Click a joint to activate it; the weight and radius sliders for that joint appear in a detail panel beside the skeleton. Spatial, not alphabetical — you select "the left wrist" by pointing at a left wrist.

**Live model diagram (Boids tab).** Two side-by-side SVG columns, boid↔boid and boid↔body. Concentric rings show the three interaction radii at true relative scale (the hard eligibility cutoff); marks above and below a zero baseline show the signed weights, colour-coded — separation amber `#e0a800`, alignment green `#4fb477`, cohesion blue `#3f8efc`. It updates live as you drag, and it visualises the thing that is otherwise invisible: the *shape* of a boid's perception.

Both panels show **ratios, not absolute values**. Each scales to the largest effective value in its group (base × ★ multiplier): the biggest ring always reaches the panel edge and the others are drawn as a fraction of it, and the same goes for the largest |weight| and the force marks. Values far outside the slider range therefore never clip onto the edge and overlap — only genuinely equal values coincide. The force panel prints its absolute scale (`±N` at the ends of the axis), which never drops below ±1, so a group of small weights stays visibly small instead of being zoomed to full height. Each force mark sits on a vertical track with a coloured fill from the zero baseline, so it reads as a vertical slider. The ★ multipliers change the legend values and the axis labels rather than the geometry (above the ±1 floor). While a ring or mark is being dragged the scale is frozen, so the dragged element tracks the pointer; on release the diagram renormalises to the new largest value.

**Header actions:** `Rec` (toggle recording; opens a rename modal), `Scenes` (open scene manager), `Export` / `Import` (parameter JSON), `Sync` (request full state).

### 5.2 Phone controller (`phone.html` / `phone.js`)

Landscape-only touch controller served at `http://<LAN_IP>:3000/phone.html`. Prompts for fullscreen / Add-to-Home-Screen on load; shows a rotation hint in portrait. Communicates **only** over WebSocket — it is a different device, so BroadcastChannel is unavailable. Not an ES module: plain `<script>`, no `import`/`export`.

**Layout:** map-set bar (top) · slider zone · toggle zone. The surface **starts blank**: the operator adds each slider (up to 8) and toggle (up to 12) and picks its parameter. Control sizes are fixed rather than scaled to the count: the slider zone has a fixed height, faders are width-capped, and toggles sit in fixed-height rows of four. Leftover space goes to the dashed *Add* tiles, so they stay easy to hit. Sliders are fill faders: drag vertically to move the value relative to where the finger landed (a touch never makes it jump).

**The slot system.** No control is hard-wired. Sliders and toggles are *slots*, assignable to any parameter at runtime:

- Tap a dashed `+` → assignment panel; the slot is created only once a parameter is picked.
- Long-press a control → assignment panel to remap, or *Remove* it.
- Tap a slider's value readout → set a custom min/max, so a slider can be zoomed into the region that matters for the current piece.

Assignable ranges are drawn from `PARAM_GROUPS` (Population, Boid-Boid Radii, Boid-Boid Weights, Boid-Body Radii, Boid-Body Weights, Appearance, Pose Detection); booleans from `BOOL_GROUPS` (Webcam, Visual Toggles, Visualizations, Debug, Recording, Actions). The Actions group holds pseudo-keys `_cameraPopup` and `_fullscreen` — commands rather than state.

**Map sets (A–F).** Up to six mapping layers. Critically, a map set stores **only which parameter sits in which slot** (plus custom slider ranges) — **not parameter values**. Switching a map set swaps the control surface without touching the simulation. This is how a handful of on-screen controls give access to the full parameter set: the operator flips layers the way an organist changes stops.

**Genie navigation.** Long-press a map-set pill, then slide vertically to preview and select — the whole gesture is one thumb, no precise targeting, designed for operating in the dark.

**Views.** A bottom tab bar switches between Controls, Body and Scenes. The A–F map-set bar only shows in Controls.

**Scenes view.** Mirrors the scene manager running on the laptop. It lists the loaded scenes with the active one highlighted, shows a *Transitioning* indicator during a slew, and has large Prev/Next buttons at the bottom; each button names the scene it will go to. Tapping a scene or Prev/Next activates it exactly as a click in `scenes.html` would. `scenes.html` keeps the scene data and joins the WebSocket relay to send only the names, active index and transition state (`scene-list`). It receives `scene-activate` requests back. If the scene manager is not open, the view says so.

**Phone setup in scenes.** An exported scene carries the phone's whole setup (sliders, toggles, custom ranges, map sets A–F, active set) as `_phone`. Loading that scene, from the scene manager or via Import in the controls window, restores the phone to that setup. Scenes without `_phone` leave the phone as it is.

**Skeleton mode (Body).** An alternate phone screen: a touchable SVG skeleton for enabling keypoints and adjusting their per-joint weight/radius sliders directly.

**Persistence:** all slot assignments, the map-set array, and the active index are stored in `localStorage` under `phone-ctrl-v3`.

### 5.3 Scene manager (`scenes.html`)

Load scene JSON files by button or drag-and-drop, reorder by dragging, activate by clicking. Configure slew duration (0–30 s), easing curve, and the fade-transition toggle. Prev/Next buttons step through the list — a scene playlist for performance.

### 5.4 Main-page keyboard

- `F` — toggle fullscreen
- `+` / `−` — increase / decrease boid size

---

## 6. Visual Styles & Properties

### Rendering strategy: three layers

| Layer | Technology | Contents |
|---|---|---|
| **Base** | p5.js `WEBGL` canvas | Background fill, boids as GL points |
| **Overlay** | Native Canvas 2D, `position:fixed`, `z-index:1`, `pointer-events:none` | Webcam feed, skeleton, keypoints, radius circles, path trails, COM lines, heatmaps, flow field |
| **HUD** | DOM elements | Status bar (bottom-left), performance readout (bottom-right) |

The 2D overlay is a **separate native canvas**, deliberately not p5's. Mixing 2D drawing calls into a WEBGL p5 context is slow and state-fragile; a sibling canvas composited by the browser is both faster and cleaner. It also enables an important optimisation: if nothing on the overlay is enabled, the overlay skips its clear-and-redraw entirely (tracked by a `_wasDirty` flag) and costs nothing.

### Boid rendering — custom GLSL

Boids are drawn as `gl.POINTS` through a hand-written shader pair, bypassing p5's drawing API entirely. One `drawArrays` call for the whole population — this is what makes 10 000 boids viable.

**Vertex shader** maps canvas pixel coordinates to clip space and sets `gl_PointSize`:

```glsl
vec2 clip = (aPosition / uResolution) * 2.0 - 1.0;
clip.y = -clip.y;
gl_Position = vec4(clip, 0.0, 1.0);
gl_PointSize = uPointSize;
```

**Fragment shader** discards fragments outside a radius-0.5 disc, turning the square point sprite into a circle:

```glsl
vec2 coord = gl_PointCoord - vec2(0.5);
if (dot(coord, coord) > 0.25) discard;
```

Point size is `max(1, boidBaseSize + 2 × boidRadiusOffset)`, where `boidBaseSize = max(2, 12 × triangleSize)` is the size the simulation uses for every interaction radius. `boidRadiusOffset` (Appearance → Boids → Size Offset, −20 to +60 px) is **visual only**: it grows or shrinks the drawn radius without touching forces, radii, the spatial grid or the radius overlays. The 1 px floor keeps boids visible at any negative offset. Blending is `SRC_ALPHA / ONE_MINUS_SRC_ALPHA` with depth testing disabled, so `boidAlpha` produces genuine additive-looking density: overlapping boids accumulate into brighter regions, and a low alpha with a high count reads as smoke or a probability cloud rather than as discrete dots.

GPU buffers are reused via `bufferSubData` whenever the existing allocation is large enough, with `bufferData` only on growth. p5's current shader program is saved and restored around every custom draw so p5's own rendering keeps working.

> **Note on naming:** `triangleSize` and `showTriangle` are historical. Boids render as circular points, not triangles. The keys were kept for scene-file compatibility.

A **second shader program** handles mood colouring: an extra per-vertex `aMood` float attribute is branched in the vertex shader to a `vColor` varying, so all seven mood colours draw in the same single draw call.

### Appearance parameters

| Parameter | Default | Notes |
|---|---|---|
| `canvasBgR/G/B` | 0, 0, 0 | Canvas background, per-channel |
| `boidR/G/B` | 255, 255, 255 | Boid colour, per-channel |
| `boidAlpha` | 1.0 | 0–1; the primary density-feel control |
| `triangleSize` | 1 | Boid size (12 px per unit), 0–100. Also the base of every interaction radius |
| `boidRadiusOffset` | 0 | Visual-only px added to the drawn radius, −20 to +60. Ignored by the simulation |
| `showTriangle` | true | Master boid visibility |
| `separationRadiusColor/Alpha/Width` | `#00c8ff` / 0.39 / 1 | Separation radius overlay stroke |
| `alignmentRadiusColor/Alpha/Width` | `#00ff00` / 0.39 / 2 | Alignment radius overlay stroke |
| `cohesionRadiusColor/Alpha/Width` | `#ffff00` / 0.39 / 2 | Cohesion radius overlay stroke |
| `pathColor` / `pathAlpha` / `pathStrokeWidth` | `#ffffff` / 0.4 / 1 | Motion trails |
| `comLineColor` / `comLineAlpha` / `comLineWidth` | `#ff0000` / 0.47 / 1.5 | Centre-of-mass lines |
| `skeletonColor` / `skeletonAlpha` | `#ffffff` / 0.5 | Pose skeleton |
| `keypointColor` / `keypointAlpha` | `#ff6464` / 1.0 | Active keypoint markers |
| `densityColor` / `densityAlpha` | `#3987e5` / 0.35 | Density heatmap hue and peak opacity |
| `speedColor` / `speedAlpha` | `#eb6834` / 0.35 | Speed heatmap hue and peak opacity |
| `flowColor` / `flowAlpha` / `flowLineWidth` / `flowArrowScale` | `#ffffff` / 0.6 / 1.5 / 0.4 | Velocity flow field |
| `mood*Color` (7 keys) | see §2 | Per-force mood palette |
| `gridCellSize` | 60 | Analysis grid cell size, 20–200 px |

Colours are stored as RGB triplets where the value is also read by the shader (canvas background, boid colour) and as hex strings where only Canvas 2D consumes them (path, COM, skeleton, keypoint). The controls UI presents both as a single colour swatch and converts.

### Overlay elements

**Webcam feed** — drawn first, behind everything, at fixed `globalAlpha 0.35`, clipped to canvas bounds (fill mode overflows by design), mirrored via `translate + scale(-1, 1)` when enabled.

**Radius circles** — one stroked circle per boid per enabled radius. Each radius has its own Color, Opacity and Width controls (Appearance → Interaction Radii; they appear under a radius once it is switched on), stored as `<radiusKey>Color` / `Alpha` / `Width`. Defaults: separation cyan `#00c8ff` @ 1 px, alignment green `#00ff00` @ 2 px, cohesion yellow `#ffff00` @ 2 px, all at 0.39 opacity. Expensive at high boid counts — a debugging tool, though visually striking as a deliberate aesthetic at low counts.

**Path trails** — a 100-frame ring buffer holding position snapshots for up to the first 500 boids. The tracked set is a **fixed index range**, not a stride: an earlier count-dependent stride made trail slots drift between different boids whenever the population changed, producing jumping artefacts. Each tracked boid's history is stroked as one polyline.

**COM lines** — a line from each boid to its `localCOM`, batched into a single `beginPath`/`stroke` for the whole population. Boids with no cohesion neighbours have `localCOM = (0,0)` and are skipped. Visually this exposes the flock's internal graph structure — clusters appear as dense stars, and the lines flicker as membership changes.

**Density heatmap** — canvas divided by `gridCellSize` (20–200 px). Cell density is normalised against the frame maximum, then drawn in **one hue** (`densityColor`, default `#3987e5`) with **opacity carrying the magnitude**: `_rampCell()` sets `globalAlpha = densityAlpha × (0.12 + 0.88 × t)`. The `0.12` floor keeps the sparsest occupied cells visible instead of vanishing into the background.

> Both heatmaps used to sweep hue (blue 240° → red 0° for density, violet 270° → red for speed) through a precomputed HSL lookup table. That was replaced: a rainbow ramp implies categories that aren't in the data, and its perceived ordering doesn't match magnitude. One hue plus opacity is a sequential ramp — it reads correctly and it made the LUT unnecessary.

**Speed heatmap** — same grid, same single-hue ramp, cells keyed to average speed via `speedColor` / `speedAlpha`.

**Velocity flow field** — one normalised arrow per occupied cell with a filled arrowhead, fully parameterised: `flowColor` (default `#ffffff`), `flowAlpha` (0.6), `flowLineWidth` (1.5), and length `cellSize × flowArrowScale` (0.4). Reveals large-scale currents invisible in the raw dot cloud.

All three share one `GridAnalytics.compute()` pass — density, average velocity, and average speed accumulate in a single loop over positions into reused typed arrays.

**Skeleton** — bones drawn from 16 `SKELETON_CONNECTIONS` pairs plus a 3 px dot at every joint above `kpConfidence`.

**Active keypoints** — for each *enabled* keypoint: a 7 px filled dot, a ring at `bodyCohesionRadius` drawn at 0.3× the dot's opacity (showing the actual reach), and a monospace text label ("L wrist", "nose"). This is the overlay that makes the interaction legible to an audience.

### Recording

`recordingMode` locks the canvas to **1280×720** (resize is ignored while active) and starts `MediaRecorder` on `canvas.captureStream(30)` at 8 Mbps, negotiating VP9 → VP8 → generic WebM. On stop the blob is **held**, not downloaded, until a filename arrives from the rename modal — so nothing is written to disk before the operator has named it. Either arrival order works.

---

## 7. Tech Stack

### Runtime dependencies

| Layer | Technology | Version | Served from | Role |
|---|---|---|---|---|
| Creative coding | **p5.js** | 1.9.4 | `vendor/p5.min.js` | Canvas lifecycle, WEBGL context, `createCapture`, `deltaTime`, `frameRate`, fullscreen |
| ML runtime | **@tensorflow/tfjs-core** | 4.22.0 | `vendor/tf-core.min.js` | Tensor ops, backend registry |
| GPU backend | **@tensorflow/tfjs-backend-webgpu** | 4.22.0 | `vendor/tf-backend-webgpu.min.js` | WebGPU compute for inference |
| Model loading | **@tensorflow/tfjs-converter** | 4.22.0 | `vendor/tf-converter.min.js` | Loads the graph-model format MoveNet ships in |
| Pose model | **@tensorflow-models/pose-detection** | 2.1.3 | `vendor/pose-detection.min.js` | MoveNet MultiPose Lightning wrapper |
| Model weights | **MoveNet MultiPose Lightning** | v1 | `vendor/movenet-multipose-lightning/` | 9.4 MB graph model — `model.json` + 3 weight shards |
| QR codes | **qrcode-generator** | 1.4.4 | `vendor/qrcode.min.js` | Phone URL QR in the controls popup |
| Server | **Node.js** ≥ 18 + **ws** | `ws 8.19.0` (exact) | npm | Static HTTP server, WebSocket relay |

**`ws` is the only npm dependency, and nothing loads from a CDN at runtime.** Every browser-side dependency is vendored into `app/vendor/` (~12 MB) and served by `server.js` at `/vendor/`, so the installation boots with no internet and cannot break when an upstream package publishes. There is no build step, no bundler, no transpiler, no framework. Source files are served as authored.

`scripts/vendor.sh` populates `app/vendor/`; all versions are pinned in variables at the top of that script. `scripts/preflight.sh` re-runs it automatically when a file is missing or truncated. See §9.

### Browser platform APIs

| API | Use |
|---|---|
| **WebGPU** | TF.js inference backend |
| **WebGL** (via p5 WEBGL) | Custom GLSL point renderer |
| **Canvas 2D** | Debug/visualization overlay |
| **Web Workers** (ES module type) | Off-thread flocking simulation |
| **Transferable objects** | Zero-copy `ArrayBuffer` handoff, double-buffered |
| **BroadcastChannel** | Same-origin control ↔ main messaging (`"flock-controls"`) |
| **WebSocket** | Phone and cross-machine messaging |
| **MediaDevices** (`getUserMedia`, `enumerateDevices`) | Webcam capture and camera switching |
| **MediaRecorder** + `canvas.captureStream()` | WebM export |
| **localStorage** | Phone controller persistence |
| **ES modules** | All main-page source; `phone.js` is deliberately *not* a module |
| **SVG** | Interactive skeletons, model diagram, tab icons |
| **Fullscreen API** | Projection mode |

### Architectural techniques

- **Web Worker offload** — simulation never touches the render thread.
- **Double-buffered transferables** — alternating buffer sets work around transfer neutering; no per-frame allocation.
- **Dirty-flag state sync** — full state crosses the worker boundary only when it changed.
- **Spatial hash grid** — O(n) neighbour queries with a frame-adaptive cell size and a reused output array.
- **Fused force loops** — one distance computation serves separation, alignment, and cohesion.
- **Neighbour cap** — bounded worst case in dense clusters.
- **Flat typed arrays everywhere** — positions, velocities, COMs, body agents, mood; no object churn in hot paths.
- **Allocation-free hot paths** — reused steer scratch object, reused active-keypoint array, in-place mutation of smoothed keypoints.
- **Single-hue heatmap ramp** — one `fillStyle` set per heatmap, only `globalAlpha` varies per cell. Removed the 271-entry HSL lookup table the old hue sweep needed, and no colour string is constructed per cell per frame.
- **Early-out overlay** — 2D canvas skips clear+redraw when nothing is enabled.
- **Throttled HUD** — perf overlay writes DOM at ~4 Hz.
- **GPU buffer reuse** — `bufferSubData` over `bufferData` when capacity allows.
- **Declarative UI generation** — controls built from data structures, not hand-written DOM.
- **Frame-rate-independent integration** — normalised `dt`.

### Browser requirements

**Chrome (or Chromium) is required**, for WebGPU support in the TF.js backend. The app must be served over **HTTP** — `file://` cannot load ES modules or Web Workers, and `index.html` detects this and displays instructions rather than failing silently. Webcam access requires `localhost` or a secure context.

---

## 8. File Map

The project root holds only the launchers and the guides. Code lives in three folders:

- **`app/`** — everything the browser loads. `server.js` serves this folder as the web root, so URLs carry no `app/` prefix (`/phone.html`, `/vendor/p5.min.js`). All browser files sit flat in it because they import each other by `./name.js`.
- **`server/`** — `server.js` with its own `package.json`, lockfile and `node_modules/`.
- **`scripts/`** — `preflight.sh` and `vendor.sh`. Both work from the project root regardless of where they are invoked.

| File | Lines | Role |
|---|---|---|
| `app/index.html` | 57 | Main page. Vendored script tags, `file://` guard, HUD elements, auto-opens the controls popup |
| `app/main.js` | 423 | p5 lifecycle, worker orchestration, path ring buffer, MediaRecorder, camera switching, keyboard |
| `app/state.js` | 233 | Single source of truth — every parameter plus typed coercion |
| `app/boid-worker.js` | 409 | The simulation. Vector math, fused flocking, edge avoidance, integration, buffer packing |
| `app/spatial-grid.js` | 54 | Hash-grid spatial partition |
| `app/pose-tfjs.js` | 258 | MoveNet setup, detection loop, coordinate transform, smoothing, body-agent packing |
| `app/renderer.js` | 544 | GLSL point renderers (standard + mood) and the whole Canvas 2D debug overlay |
| `app/grid-analytics.js` | 76 | Shared density / speed / velocity grid computation |
| `app/channel.js` | 259 | BroadcastChannel + WebSocket bridge, message dispatch, scene slew engine |
| `app/controls.html` / `app/controls.js` | 615 / 1896 | Desktop control popup — 4 tabs + Setup side panel, declarative controls, interactive skeleton, model diagram, randomizer, camera gate, export/import |
| `app/phone.html` / `app/phone.js` | 504 / 1330 | Phone controller — slot system, map sets, genie navigation, skeleton mode |
| `app/phone-manifest.json` | 9 | PWA manifest for Add-to-Home-Screen |
| `app/scenes.html` | 596 | Scene manager — load, reorder, activate, slew configuration |
| `app/camera-popup.js` | 65 | Legacy camera popup (currently a no-op; `triggerCameraPopup()` is stubbed in `main.js`) |
| `app/vendor/` | — | Vendored browser libraries + MoveNet weights (§7) |
| `server/server.js` | 270 | HTTP static server (web root `../app`), WebSocket relay, master/slave roles, `/api/phone-url`, `/api/role` |
| `scripts/preflight.sh` | 131 | Dependency gate sourced by every launcher |
| `scripts/vendor.sh` | 90 | Downloads `app/vendor/` |
| `start.command` / `start-master.command` / `start-slave.command` | — | Finder-launchable startup scripts (project root) |

Line counts are indicative of relative weight, not a contract — treat a drift of a few dozen lines as normal.

Legacy files (`flocking6.js`, `boid.js`, `pose.js`) have been removed from this variant; they exist in the backup directory for reference only.

---

## 9. Running the System

See `RUNNING.md` for the operator-facing version of this section.

```bash
./scripts/vendor.sh          # once, while online — downloads browser deps into app/vendor/ (~12 MB)
(cd server && npm install)   # once — installs ws
node server/server.js        # standalone, port 3000
```

Or double-click `start.command` from Finder — the supported path, because it runs the dependency gate first. Each `.command` sources **`scripts/preflight.sh`**, which checks and self-repairs in order:

1. **Node.js** present and ≥ 18 — otherwise points at nodejs.org / `brew install node`.
2. **npm dependencies** — auto-runs `npm ci` in `server/` (falling back to `npm install`) when `require('ws')` fails there.
3. **Google Chrome** — required for WebGPU; Safari cannot run the pose backend.
4. **`app/vendor/`** — verifies all 10 vendored files by size and calls `scripts/vendor.sh` to re-fetch anything missing or truncated.

Anything it cannot repair prints a numbered problem and stops, rather than opening Chrome onto a half-working rig. Only step 4 needs internet, and only when `app/vendor/` is incomplete — once populated the system runs fully offline. Running `node server/server.js` by hand skips the gate entirely.

The launcher then prints the LAN IP, opens the main page in Chrome, and prints the phone URL.

**Multi-machine:**

```bash
node server/server.js --master              # or double-click start-master.command
node server/server.js --slave <master-ip>   # or double-click start-slave.command
                                     # (default master IP is editable at the top of the script)
```

**Endpoints:**

| URL | Purpose |
|---|---|
| `http://localhost:3000/` | Main visualization (auto-opens controls popup) |
| `http://<LAN_IP>:3000/phone.html` | Phone controller |
| `http://localhost:3000/scenes.html` | Scene manager |
| `http://localhost:3000/api/phone-url` | `{ url, ip, port }` |
| `http://localhost:3000/api/role` | `{ role, slaveCount \| connected }` |
| `ws://<master-ip>:3000/slave-link` | Slave uplink |

**Adding a parameter** — three places, in order:

1. `state.js` — add the key with a default, and register it in the correct coercion set (`numKeys`, `roundKeys`, or `boolKeys`).
2. `controls.js` — add a row object to the relevant `CONTROLS` section.
3. `phone.js` — add it to `PARAM_GROUPS` (ranges) or `BOOL_GROUPS` (booleans) if it should be phone-assignable.

Skipping step 1 means the value is silently discarded by `setKey()`.
