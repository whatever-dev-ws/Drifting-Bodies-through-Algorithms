# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Phone-control variant of the CCL25 interactive flocking system. Extends the base codebase (see `../CLAUDE.md` for core architecture) with a **phone-based touch controller** and a **Node.js relay server**. The phone connects over LAN via WebSocket, providing sliders/buttons/toggles with a **map set** system for switching between different control mappings.

## Running

Operator-facing launch guide: **`RUNNING.md`** (how to start it, what each script does, what has to be switched on).

```bash
node server/server.js   # or: ./start.command (double-click from Finder)
```

`server.js` serves the `app/` folder over HTTP on port 3000 and runs a WebSocket relay on the same port. Opens `index.html` (main visualization) in Chrome. Phone controller is at `http://<LAN_IP>:3000/phone.html`. No build step. The only npm dependency is `ws`; every browser-side dependency is vendored in `app/vendor/`. The `.command` launchers verify and repair all of this via `scripts/preflight.sh` — running `node server/server.js` by hand skips that check. See **Dependencies** below.

Multi-machine (one machine per projector, parameters kept in sync):

```bash
node server/server.js --master              # or ./start-master.command
node server/server.js --slave <master-ip>   # or ./start-slave.command
```

Slaves connect upstream over `ws://<master-ip>:3000/slave-link`. `/api/role` reports the current role.

Multi-machine behaviour (verified by a 3-server integration test):
- Master changes (controls, phone, scene slews, selective import) reach every slave frame by frame.
- Each machine clamps to its own GPU limit.
- Scene list, phone layouts and phones on a slave stay local to their machine.
- A slave-local edit lasts only until the next master change, because every master change re-sends the full state.
- "Pull from Master" (slave link strip in the controls window) makes the master ask **every** local client for `sync`. Only a main page answers. Asking just the first client failed whenever that client was a phone or the scene manager.
- The static server strips `?query`/`#hash` from URLs.
- **Each machine keeps its own camera and detection settings.** The slave server tags everything it relays from the master with `fromMaster: true`. `channel.js` (`isMasterRigKey()`) skips the Setup-panel keys (`SETTINGS_KEYS`: webcam display, detection, smoothing, perf overlay) in tagged `set`/`state`/`snapshot` messages. Local traffic on a slave (its controls window, its phones) carries no tag and applies normally. The Sync buttons respect this too.
- `recordingMode` is shared state, so recording on the master also starts recording on every slave.
- **Boid size depends on each machine's pixel density, which p5 reads only once, at page load.** p5 sets `pixelDensity = ceil(devicePixelRatio)` from whichever screen Chrome was on when the page loaded, and never re-reads it. A window loaded on the Retina screen and then dragged to a projector keeps density 2. Boids are GL points sized in buffer pixels, so the same Boid Size then draws at half size there. Chrome zoom also changes the ratio, and `ceil()` makes it worse: 110% on a 1× display gives density 2. **Setup → Debug → Re-detect Display** sends `display-refresh`. The master's server relays it to the slaves. Each main page runs `refreshDisplay()` (`main.js`), which calls `pixelDensity(ceil(dpr))` and then `windowResized()`. This is safe mid-take, because the recorder's output size is fixed at start. Each page answers with `display-info` `{ host, ip, role, dpr, density, canvas, screen }`. A slave's server forwards that report up to the master. `/api/role` supplies `host` (macOS ComputerName, because `os.hostname()` is often a generic `Mac.lan`) and `ip`. The controls window lists one line per machine and shows in orange: density or canvas size that differs between machines, a fractional DPR (zoom or scaling), and a canvas that doesn't fill the screen. The button is a `type: "display-refresh"` row with no `key`, so it never reaches state, scenes or the randomizer.

## Folder Layout

The root is kept operator-facing: only the three `.command` launchers and the guides (`RUNNING.md`, `DOCUMENTATION.md`, this file, the README PDF). Don't add code files to the root.

- **`app/`** — every browser-served file, flat (they import each other as `./name.js`, and `main.js` spawns `./boid-worker.js`). `server.js` uses it as the web root (`ROOT = path.join(__dirname, '..', 'app')`), so URLs have no `app/` prefix: `/phone.html`, `/vendor/...`. Subfoldering it would change those URLs and break phone bookmarks / Add-to-Home-Screen installs.
- **`server/`** — `server.js`, `package.json`, `package-lock.json`, `node_modules/`. `require('ws')` resolves from here.
- **`scripts/`** — `preflight.sh` (sourced by launchers, so its cwd is the **project root**; npm steps run in `(cd server && …)` subshells) and `vendor.sh` (cds to the project root itself, writes `app/vendor/`).

Everything in this file that names a browser file (`main.js`, `controls.js`, `state.js`, …) means `app/<name>`.

## Dependencies

Every `.command` launcher sources **`scripts/preflight.sh`** before starting the server. It checks and self-repairs, in order: sibling launcher quarantine + exec bits → Node.js ≥ 18 → npm deps in `server/` (auto-runs `npm ci`/`npm install`) → Google Chrome → `app/vendor/`. Anything it cannot fix prints a numbered problem and stops, rather than opening Chrome onto a half-working rig.

**All browser dependencies are vendored** into `app/vendor/` (~12 MB) and served by `server.js` at `/vendor/`. The table below lists the served paths. Nothing is loaded from a CDN at runtime, so the installation boots with no internet and cannot break when an upstream package publishes:

| File | Package | Pinned |
|---|---|---|
| `vendor/p5.min.js` | p5.js | 1.9.4 |
| `vendor/qrcode.min.js` | qrcode-generator | 1.4.4 |
| `vendor/tf-core.min.js` | `@tensorflow/tfjs-core` | 4.22.0 |
| `vendor/tf-backend-webgpu.min.js` | `@tensorflow/tfjs-backend-webgpu` | 4.22.0 |
| `vendor/tf-converter.min.js` | `@tensorflow/tfjs-converter` | 4.22.0 |
| `vendor/pose-detection.min.js` | `@tensorflow-models/pose-detection` | 2.1.3 |
| `vendor/movenet-multipose-lightning/` | MoveNet MultiPose Lightning weights (model.json + 3 shards, 9.4 MB) | v1 |

**`scripts/vendor.sh`** downloads all of it. Versions are pinned in variables at the top of that script — change them there, nowhere else. Run `./scripts/vendor.sh` to populate, `./scripts/vendor.sh --force` to refresh. `preflight.sh` calls it automatically when a file is missing or truncated; it skips files already present, so a repair only re-fetches what is actually broken.

Gotchas:

- **Never point the `<script>` tags in `index.html` / `controls.html` back at a CDN.** The four TF.js tags used to be unpinned (`@tensorflow/tfjs-core` with no version resolves to *latest*), which meant an upstream release could break the rig overnight with no local change.
- **`pose-tfjs.js` passes `modelUrl: '/vendor/movenet-multipose-lightning/model.json'`** to `createDetector`. Without it, MoveNet downloads ~9.4 MB from `tfhub.dev` on every cold start. pose-detection only sets `fromTFHub: true` when the URL contains `https://tfhub.dev`, so a local path loads the weight shards relative to `model.json` — which is why the shard filenames in `model.json` must stay relative.
- `tfhub.dev` now 301s to Kaggle and the old `storage.googleapis.com/tfhub-tfjs-modules` mirror returns 403. Only the `…/model.json?tfjs-format=file` form still resolves; `vendor.sh` uses it.
- `server.js` needs `.bin` in its `MIME` map for the weight shards.
- `ws` is pinned to an exact version (`8.19.0`, not `^8.0.0`) with `engines.node >= 18`.
- **macOS quarantine is the one dependency preflight cannot self-heal for the running launcher.** `com.apple.quarantine` blocks the `.command` before it is sourced, so the first launch on a fresh machine needs `xattr -dr com.apple.quarantine .` from Terminal. Preflight clears the *sibling* launchers, so the dialog appears once per machine, not once per file. See `RUNNING.md`.

## Architecture Differences from Base Codebase

The base codebase uses **BroadcastChannel** for `main.js` ↔ `controls.js` communication (same-origin, same browser). This variant adds:

- **`server/server.js`** — Node.js HTTP + WebSocket relay server. Serves static files from `app/` and relays WebSocket messages between all connected clients (broadcast to all others). Provides `/api/phone-url` endpoint returning the LAN URL.
- **`channel.js`** — Extended to also open a WebSocket connection to the relay server. All `handleMessage()` calls work identically whether the message came from BroadcastChannel or WebSocket. `wsSend()` forwards state changes to the phone.
- **`phone.html` + `phone.js`** — Touch-optimized controller UI for mobile landscape. NOT an ES module (plain `<script>`). Communicates exclusively via WebSocket (no BroadcastChannel — different device). Sends `{ type: "set", key, value }` and `{ type: "sync" }` messages.

- **`scenes.html`** — scene manager. Loads scene JSON, reorders, activates. Slew duration (0–30 s), 8 easing curves (`ease-out-cubic` default), fade-transition toggle. The interpolation engine itself lives in `channel.js`.

**Message flow:** Phone → WebSocket → `server.js` relay → WebSocket → `channel.js` → `handleMessage()` → `state.js` + BroadcastChannel → `controls.js`.

Simulation and rendering live outside the files above: `boid-worker.js` (the flocking sim, in a Web Worker, results returned as transferable `Float32Array`s from two alternating buffer sets), `renderer.js` (custom GLSL point renderers + the whole Canvas 2D debug overlay), `pose-tfjs.js` (MoveNet MultiPose Lightning on WebGPU), `spatial-grid.js`, `grid-analytics.js`. See `DOCUMENTATION.md` §2–4 and §6.

**Radii are factors of on-screen boid size.** `boidBaseSize()` in `state.js` returns `max(2, 12 × triangleSize)` — the same formula `main.js` uses for the sprite point size. All six radii go through it (worker, spatial grid cell size, radius overlays). It previously returned the raw slider value (1), which shrank every radius 12× and made body forces effectively never fire (default body reach 4 px). `main.js` draws the sprite at `boidBaseSize(state) + 2 × state.boidRadiusOffset` — that offset (Appearance → Boids → Size Offset) is visual only and must never be added inside `boidBaseSize()`.

## Phone Controller (`phone.js`)

**Views:** a bottom tab bar switches between **Controls** (`phoneMode` `'normal'`), **Body** (`'skeleton'`) and **Scenes** (`'scenes'`) via `setPhoneMode()`. The map-set bar (44px pills, 8px padding) only shows in Controls.

**Scenes view:** a mirror of `scenes.html` on the laptop. `scenes.html` joins the WebSocket relay itself (the phone cannot hear BroadcastChannel) and publishes `{ type: 'scene-list', names, activeIndex, transitioning }` from `renderList()` on every list change and on slew-status. On `pagehide` it sends `{ closed: true }`. The phone sends `scene-list-request` (on connect and on entering the view) and `scene-activate { index }`, which `scenes.html` runs through `activateScene()`, so it is identical to clicking there. Only names cross the wire, never scene data. `server.js` does not forward these types to slaves, so they stay on the local machine.

**Controls layout:** Portrait. Slider zone + toggle zone. **Starts blank** — the operator adds sliders (max `MAX_SLIDERS` = 8) and toggles (max `MAX_TOGGLES` = 12). `renderControls()` rebuilds `#controls-area` from the slot arrays on every structural change (add/remove/remap/map-set switch); value updates go through `syncAllFromState()`/`syncSlider()` without a rebuild. **Sizes are fixed, not count-scaled:** the slider zone has a fixed height (`--slider-zone-h`), faders share its width up to an 88px cap, and the dashed add tile takes the leftover width; toggles are a 4-column grid of fixed-height rows (`--toggle-row-h`) where the add tile spans the rest of the last row. This keeps the add targets large. Sliders are custom fill faders (`.fader` / `.fader-fill`, value in `--fill`), not `<input type=range>`: pointer drags are **relative** (touching never jumps the value), and holding still anywhere on a slider column opens the remap panel. Prompts for fullscreen/Add to Home Screen on load.

**Slot system:** Sliders and toggles are "slots" that can be assigned to any parameter at runtime:
- `sliderSlots` array — maps to range parameters from `PARAM_GROUPS` (key, customMin, customMax)
- `toggleSlots` array — maps to boolean parameters from `BOOL_GROUPS`
- Both arrays are variable-length with **no empty entries**: a dashed `+` tile opens the assignment panel with `index === slots.length`, and the slot is pushed only when a parameter is picked
- Long-press a control to remap or remove it
- Tap a slider's value display to set custom min/max range

**Map set system:** Up to 6 map sets (A–F) stored in the `scenes` array. Each map set is a **mapping layer** — it stores only which parameters are assigned to which slots, NOT parameter values. Switching map sets swaps the control mappings without changing any simulation state. This allows the operator to access more parameters than fit on screen at once by quickly switching layers.

Each map set captures:
- Slot assignments (which parameter is mapped to each slider/toggle)
- Custom min/max ranges for sliders

Map set operations:
- `collectSceneData()` — snapshots current slot assignments
- `recallScene(index)` — restores assignments via `restoreAssignmentsFromScene()`, syncs UI to current live state
- `saveAssignments()` — persists active map set to localStorage
- Genie navigation: long-press a map set pill then slide vertically to preview/select

**Persistence:** localStorage key `phone-ctrl-v3`. Stores all slot assignments, map sets array, and active map set index.

**Phone setup travels with scenes (`_phone`).** The phone publishes its whole setup (`collectPhoneLayout()`: live slots, custom ranges, map sets, active map set; same shape as localStorage) as `phone-layout` on connect, on `phone-layout-request`, and on every `saveAssignments()`. `channel.js` holds the last one (`lastPhoneLayout`), forwards it on BroadcastChannel and replays it on `hello`. `controls.js` keeps it in `phoneLayout`, and `doExport()` writes it into the scene JSON as `_phone`. Loading works both ways. A `load-scene` carrying `_phone` (scene manager) makes `channel.js` send `phone-layout-apply` to the phone, and the controls window's Import posts `phone-layout-apply` on BroadcastChannel for `channel.js` to forward. The phone then replaces its setup via `applyPhoneLayoutFromScene()`. **One layout for all phones:** `lastPhoneLayout` is last-writer-wins, so an export holds whichever phone published most recently, and `phone-layout-apply` is relayed to every connected phone, which all adopt it. Phones aren't identified, and none of this crosses master/slave links. The `_` prefix keeps it out of every state path, because both import and the scene slew skip `_` keys. Scenes without `_phone` leave the phone untouched.

**Body view:** the skeleton is hit-tested as a whole (nearest joint within `KP_HIT_RADIUS` viewBox units, since the head joints are about 8 units apart). Per-joint weight/radius use `.hfader` horizontal fill faders: 52px tall, relative drag, and `touch-action: pan-y` so vertical swipes still scroll the panel. `KP_RANGE` must match `buildKpGroup()` in `controls.js` (0–5, step 0.1).

## Gotchas

- **Safe areas (`phone.html`).** The status bar style is `black`, but on device iOS still draws the page under the status bar, and its system blur fades out about 13px *below* the top inset. So `.top-bar` (and `.assign-header`) pad by `inset + min(inset, 20px)`: the extra clearance applies only when there is an inset. A head script adds `viewport-fit=cover` and `html.installed` **only in the Home Screen app**. Every inset goes through `--sa-top/bottom/left/right` vars, which are 0 unless `.installed` is set, so a Safari tab never picks up its floating toolbar's inset. Never use `env(safe-area-inset-*)` directly. `.tab-bar` uses `inset − 14px` (≈20px), not the full 34px home-indicator inset, so its buttons clear the indicator without a dead band.
- **Dashed outlines use `--dash-outline`** (an SVG background on `:root`), never `border-style: dashed`. Browsers scale CSS dashes to the border width and stretch them per side to fit each box, so a 44px pill and a wide tile never matched. The SVG's stroke colour is hardcoded to `--control-bg-hover` (`#58585a`) because a data URL can't read CSS vars. Press states must set `background-color`, not `background`, or they wipe the outline.
- **`phone.js` is NOT an ES module** — loaded as a plain `<script>` in `phone.html`. Do not add `import`/`export`.
- **Map set assignments are per-set** — `restoreAssignmentsFromScene()` clears all global slot arrays and rebuilds from map set data. The global `sliderSlots`/`toggleSlots` always reflect the active map set. It also migrates old saves: null holes from the fixed 6+4+4 layout are dropped and the legacy `buttons` array is folded into `toggles`.
- **Never read a parameter's value from its `<input type=range>`** (`controls.js`). A range input clamps to its own min/max, but the number box beside it accepts values past the slider range (shown orange, `.out-of-range`). Range rows expose the true value as `inputsByKey.get(key).getValue()`. Export (`collectCurrentState`) and the import slew (`startSlew`) use it; reading `ui.input.value` silently clamps the value to the slider's end stop.
- **Values the system can't honour are clamped in `state.js`, not in the UI.** `setKey()` refuses non-finite numbers (JSON would turn them into `null`) and clamps to *effective* limits via `clampToEffective()`. Size Offset is held where the drawn sprite actually changes: GPU `ALIASED_POINT_SIZE_RANGE` (reported by `main.js` through `setHardwareLimits()`, 511px on Apple GPUs) and the 1px floor. Boid Size is held at ≥ 1/6, the 2px floor of `boidBaseSize()`. Floors that prevent crashes: `boidCount ≥ 0`, `maxNeighbours ≥ 0`, `gridCellSize ≥ 1`. `clampToEffective()` runs on every `setKey`. Every UI echoes state, so the controls box, the phone and exports all show the cap, not the typed number. A new hard ceiling goes in `clampToEffective()`, never as a silent clamp in the renderer or worker. Boid Size has no upper clamp: past about 42.6 only the sprite caps, and the interaction radii keep scaling.
- **Worker buffers are transferred, so they detach** (`boid-worker.js`). A detached typed array reads `length 0`, so a length check alone treats it as a valid empty buffer. Reusing one for a 0-boid frame threw `DataCloneError`, and the frozen simulation came from that. `reusable()` never reuses zero-length arrays. `main.js` also clears `workerBusy` in `worker.onerror`, so any worker exception costs one frame instead of stalling the loop forever.
- **Path trails are keyed by boid index** (`main.js` `pathData`, drawn in `renderer.js`). Every boid is recorded, with no sample cap. The boid count comes from the *newest* ring snapshot; using the oldest delayed new trails by `PATH_MAX` frames. `birth[i]`/`seq[k]` keep a reused index (population shrank, then regrew) from drawing a line out of the previous boid's history. Cost is about 6ms per 1000 trails per frame in software Canvas 2D, and one batched `stroke()` is no faster.
- **Map sets are mapping layers only** — they store slot assignments and custom ranges, NOT parameter values. Switching map sets never changes simulation state.
- **WebSocket relay is dumb** — `server.js` broadcasts to all OTHER clients. It has no knowledge of message types or state. The phone, the main page and `scenes.html` all connect as WebSocket clients.
- **Adding phone parameters** — new range params go in `PARAM_GROUPS` + `PARAM_BY_KEY`; new booleans go in `BOOL_GROUPS` + `BOOL_BY_KEY`. The key must also exist in `state.js` with proper coercion registration (see parent CLAUDE.md).

## Controls Popup Layout

Diverges from the parent codebase. Split into **4 tabs** (touched during a show) and a **Setup side panel** behind the cog (rig config, set once). `TABS` in `controls.js` is the source of truth; a section's `tab` property routes it.

Tabs:

- **Pose** (`pose`): interactive skeleton — 17 keypoints as a clickable SVG body; the selected joint's weight/radius sliders appear in the detail panel beside it. Not a flat checkbox list.
- **Boids** (`boids`): Population, Frame Repulsion (`edgeMargin`/`edgeStrength`), boid↔boid and boid↔body radii/weights, live model diagram.
- **Appearance** (`appearance`): merges the former Style and Visual tabs. Sections grouped **by subject**, not control type, then ordered into families by semantic closeness. Each section declares a `group`; the build loop renders an unlabelled `.section-group` divider line between runs (none above the first). Families: **Boids & Canvas** (Boids — Mood coloring is a checkbox row inside it, with its 7 colours as sub-rows, because mood only renders through the boid draw call; then Canvas, last) · **Body** (Skeleton, Keypoints) · **Behaviour** (Interaction Radii, Center of Mass, Path Trail — what a boid perceives, where it is pulled, where it went) · **Field Analysis** (Analysis Grid, Density Heatmap, Speed Heatmap, Velocity Flow). Order in `CONTROLS` is display order — keep a family's sections contiguous or its divider repeats.
- **Rand** (`rand`): randomizer over the Boids + Appearance tabs (`RAND_TABS`), row types `range`/`checkbox`/`color` (`RAND_TYPES`).

Setup panel (`tab: "settings"` → mounted into `#settings-body`): Source (camera select), Webcam Display (showVideo/fill/mirror), Detection (minPoseScore, multiPoseMaxDimension, maxPoses, kpConfidence, kpSmoothing), Debug (showPerformanceOverlay, Tooltips, Re-detect Display — see Multi-machine behaviour). **Tooltips** is a `local: true` checkbox: a preference of the controls window only (`LOCAL_PREFS` in `controls.js`, persisted in localStorage under `flock-controls-prefs`), kept out of `inputsByKey` so it is never sent to main, synced to slaves, exported into scenes or randomized. Off adds `body.hide-tips`, which hides every `.tip`. The phone-controller QR code (`#qr-section`, filled by `initQR()` from `/api/phone-url`) sits at the bottom of this panel, after `#settings-body` — not above the tabs.

A row may declare `tile: true` — consecutive tile rows are packed side by side into one `.row-tiles` responsive grid (min 150px columns) instead of stacking; a tile run under a `parent` carries the sub-row indent on the container. Used for the seven mood colours.

A section may declare `enableKey` — renders as a bare switch (no visible text; `aria-label` = section title) in the section header that collapses the body when off. These keys gate rendering only. All current `enableKey` sections are in Appearance.

**Import is selective.** Import parses the file, then opens `#import-modal` (`openImportModal()`) instead of applying anything. Parameters are grouped by panel tab, then section, from `SCENE_SCHEMA`, which is built from `CONTROLS` plus a synthetic Pose tab of 17 joints × active/weight/radius. Each item owns every key behind its control: a colour row = hex + R/G/B, and an `enableKey` = a "Visible" item. Extra groups: Phone controller (`_phone`), and Other for keys no control owns, so they're listed rather than silently loaded or dropped. Only the ticked keys reach `applyImportedScene()`. A new `CONTROLS` row appears in the modal automatically. The scene manager (`scenes.html`) still loads whole scenes.

**Header row is identical in every role** (Rec · Scenes · Export/Import · Sync · cog). Sync always pulls from *this* machine's main page. On a master or slave, `initRole()` reveals `#link-bar`, a strip between the header row and the tabs. It shows the role, live link status (polls `/api/role` every 3 s; a hollow dot means no slaves, or master unreachable) and the one cross-machine action: **Push to Slaves** (`sync-slaves`) or **Pull from Master** (`sync-to-master`), disabled while there is no link. Never put role-specific buttons back into the header row.

`recordingMode` is a header button (Rec), not in any tab. Toggling it starts/stops MediaRecorder capture; the file downloads on stop, after the rename modal supplies a filename. **Recording composites, it never captures a display canvas directly:** boids are on p5's GL canvas, and everything else (COM lines, trails, radii, skeleton, heatmaps, webcam) is on the `DebugOverlay` canvas above it. `captureRecordingFrame()` (end of `draw()`, same task as rendering, so the GL buffer is still readable) draws both into an off-DOM `recCanvas` and calls `requestFrame()` on a `captureStream(0)` track. That happens at `REC_FPS` (30), with output capped at 1920×1080 (long × short side) whatever the window or Retina density. Codec preference is in `REC_FORMATS`: H.264 MP4 first (hardware encoder), then VP8. VP9 is left out because Chrome encodes it in software, the most CPU-heavy option. Anything new drawn on screen must land on one of those two canvases or it won't be recorded. The `#perf` HUD is DOM and is intentionally not recorded.

Camera gate: `CAMERA_GATE_ENABLED` is **`false`**, and is duplicated in `controls.js` and `main.js` — **both must agree**. When enabled it pins the Setup panel open until a camera source is chosen.

`showPerformanceOverlay` controls visibility of both the FPS/boid count overlay and the status bar ("Controls: connected | TF.js: WebGPU").

## Note on Legacy Files

Legacy files (`flocking6.js`, `boid.js`, `pose.js`) have been removed from this variant. They exist in the backup directory for reference only.

## Keyboard Shortcuts (Main Page)

- `F` — toggle fullscreen
- `+`/`-` — increase/decrease triangle (boid) size

# context-mode — MANDATORY routing rules

You have context-mode MCP tools available. These rules are NOT optional — they protect your context window from flooding. A single unrouted command can dump 56 KB into context and waste the entire session.

## BLOCKED commands — do NOT attempt these

### curl / wget — BLOCKED
Any Bash command containing `curl` or `wget` is intercepted and replaced with an error message. Do NOT retry.
Instead use:
- `ctx_fetch_and_index(url, source)` to fetch and index web pages
- `ctx_execute(language: "javascript", code: "const r = await fetch(...)")` to run HTTP calls in sandbox

### Inline HTTP — BLOCKED
Any Bash command containing `fetch('http`, `requests.get(`, `requests.post(`, `http.get(`, or `http.request(` is intercepted and replaced with an error message. Do NOT retry with Bash.
Instead use:
- `ctx_execute(language, code)` to run HTTP calls in sandbox — only stdout enters context

### WebFetch — BLOCKED
WebFetch calls are denied entirely. The URL is extracted and you are told to use `ctx_fetch_and_index` instead.
Instead use:
- `ctx_fetch_and_index(url, source)` then `ctx_search(queries)` to query the indexed content

## REDIRECTED tools — use sandbox equivalents

### Bash (>20 lines output)
Bash is ONLY for: `git`, `mkdir`, `rm`, `mv`, `cd`, `ls`, `npm install`, `pip install`, and other short-output commands.
For everything else, use:
- `ctx_batch_execute(commands, queries)` — run multiple commands + search in ONE call
- `ctx_execute(language: "shell", code: "...")` — run in sandbox, only stdout enters context

### Read (for analysis)
If you are reading a file to **Edit** it → Read is correct (Edit needs content in context).
If you are reading to **analyze, explore, or summarize** → use `ctx_execute_file(path, language, code)` instead. Only your printed summary enters context. The raw file content stays in the sandbox.

### Grep (large results)
Grep results can flood context. Use `ctx_execute(language: "shell", code: "grep ...")` to run searches in sandbox. Only your printed summary enters context.

## Tool selection hierarchy

1. **GATHER**: `ctx_batch_execute(commands, queries)` — Primary tool. Runs all commands, auto-indexes output, returns search results. ONE call replaces 30+ individual calls.
2. **FOLLOW-UP**: `ctx_search(queries: ["q1", "q2", ...])` — Query indexed content. Pass ALL questions as array in ONE call.
3. **PROCESSING**: `ctx_execute(language, code)` | `ctx_execute_file(path, language, code)` — Sandbox execution. Only stdout enters context.
4. **WEB**: `ctx_fetch_and_index(url, source)` then `ctx_search(queries)` — Fetch, chunk, index, query. Raw HTML never enters context.
5. **INDEX**: `ctx_index(content, source)` — Store content in FTS5 knowledge base for later search.

## Subagent routing

When spawning subagents (Agent/Task tool), the routing block is automatically injected into their prompt. Bash-type subagents are upgraded to general-purpose so they have access to MCP tools. You do NOT need to manually instruct subagents about context-mode.

## Output constraints

- Keep responses under 500 words.
- Write artifacts (code, configs, PRDs) to FILES — never return them as inline text. Return only: file path + 1-line description.
- When indexing content, use descriptive source labels so others can `ctx_search(source: "label")` later.

## ctx commands

| Command | Action |
|---------|--------|
| `ctx stats` | Call the `ctx_stats` MCP tool and display the full output verbatim |
| `ctx doctor` | Call the `ctx_doctor` MCP tool, run the returned shell command, display as checklist |
| `ctx upgrade` | Call the `ctx_upgrade` MCP tool, run the returned shell command, display as checklist |
