// renderer.js — WebGL point renderer + 2D debug overlay

import { getActiveKeypoints, SKELETON_CONNECTIONS } from './pose-tfjs.js';
import { state, boidBaseSize } from './state.js';

// ─── Shared GLSL snippets ──────────────────────────────────────────────

const CLIP_TRANSFORM = `
  vec2 clip = (aPosition / uResolution) * 2.0 - 1.0;
  clip.y = -clip.y;
  gl_Position = vec4(clip, 0.0, 1.0);
  gl_PointSize = uPointSize;`;

const CIRCLE_DISCARD = `
  vec2 coord = gl_PointCoord - vec2(0.5);
  if (dot(coord, coord) > 0.25) discard;`;

// ─── WebGL Boid Renderer ───────────────────────────────────────────────

const VERT_SRC = `
attribute vec2 aPosition;
uniform vec2 uResolution;
uniform float uPointSize;
void main() {${CLIP_TRANSFORM}
}
`;

const FRAG_SRC = `
precision mediump float;
uniform vec4 uColor;
void main() {${CIRCLE_DISCARD}
  gl_FragColor = uColor;
}
`;

// ─── Mood Shader ──────────────────────────────────────────────────────

const MOOD_VERT_SRC = `
attribute vec2 aPosition;
attribute float aMood;
uniform vec2 uResolution;
uniform float uPointSize;
// Mood colours come in as a uniform array so they are user-editable; the
// order matches the worker's force indices (see MOOD_KEYS below).
uniform vec3 uMoodColors[7];
varying vec3 vColor;
void main() {${CLIP_TRANSFORM}
  int m = int(aMood + 0.5);
  vColor = uMoodColors[6];                 // default: edge
  if (m == 0) vColor = uMoodColors[0];
  else if (m == 1) vColor = uMoodColors[1];
  else if (m == 2) vColor = uMoodColors[2];
  else if (m == 3) vColor = uMoodColors[3];
  else if (m == 4) vColor = uMoodColors[4];
  else if (m == 5) vColor = uMoodColors[5];
}
`;

const MOOD_FRAG_SRC = `
precision mediump float;
varying vec3 vColor;
void main() {${CIRCLE_DISCARD}
  gl_FragColor = vec4(vColor, 1.0);
}
`;

export class WebGLBoidRenderer {
  // Mood colour keys in force-index order (see _uploadMoodColors)
  static MOOD_KEYS = [
    'moodSepColor', 'moodAliColor', 'moodCohColor',
    'moodBodySepColor', 'moodBodyAliColor', 'moodBodyCohColor',
    'moodEdgeColor',
  ];

  constructor(gl) {
    this.gl = gl;
    this.program = this._compileProgram(VERT_SRC, FRAG_SRC);
    this.aPosition = gl.getAttribLocation(this.program, 'aPosition');
    this.uResolution = gl.getUniformLocation(this.program, 'uResolution');
    this.uPointSize = gl.getUniformLocation(this.program, 'uPointSize');
    this.uColor = gl.getUniformLocation(this.program, 'uColor');
    this.posBuffer = gl.createBuffer();
    this.count = 0;
    this._posCap = 0;  // allocated GPU buffer capacity (floats)
    this._moodCap = 0;

    // Mood shader program
    this.moodProgram = this._compileProgram(MOOD_VERT_SRC, MOOD_FRAG_SRC);
    this.moodAPosition = gl.getAttribLocation(this.moodProgram, 'aPosition');
    this.moodAMood = gl.getAttribLocation(this.moodProgram, 'aMood');
    this.moodUResolution = gl.getUniformLocation(this.moodProgram, 'uResolution');
    this.moodUPointSize = gl.getUniformLocation(this.moodProgram, 'uPointSize');
    // Array uniforms: query the first element — "uMoodColors" alone is not
    // reliably resolved across implementations.
    this.moodUColors = gl.getUniformLocation(this.moodProgram, 'uMoodColors[0]')
      || gl.getUniformLocation(this.moodProgram, 'uMoodColors');
    this._moodRGB = new Float32Array(21);  // 7 × vec3, refilled per frame
    this._moodHexCache = null;             // skip re-parsing when unchanged
    this.moodBuffer = gl.createBuffer();
    this._moodFloat = null; // Float32Array cache for attribute upload
  }

  // Upload a Float32Array of [x0,y0,x1,y1,...] positions
  // Reuses the GPU allocation via bufferSubData when capacity allows.
  updatePositions(positions) {
    const gl = this.gl;
    this.count = positions.length / 2;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
    if (positions.length <= this._posCap) {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions);
    } else {
      gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
      this._posCap = positions.length;
    }
  }

  render(canvasWidth, canvasHeight, pointSize, r, g, b, a) {
    if (this.count === 0) return;
    const gl = this.gl;

    // Save p5's current program so we can restore it after
    const prevProgram = gl.getParameter(gl.CURRENT_PROGRAM);

    gl.useProgram(this.program);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
    gl.enableVertexAttribArray(this.aPosition);
    gl.vertexAttribPointer(this.aPosition, 2, gl.FLOAT, false, 0, 0);

    gl.uniform2f(this.uResolution, canvasWidth, canvasHeight);
    gl.uniform1f(this.uPointSize, pointSize);
    gl.uniform4f(this.uColor, r, g, b, a);

    gl.drawArrays(gl.POINTS, 0, this.count);

    gl.disableVertexAttribArray(this.aPosition);

    // Restore p5's program so its subsequent uniform calls work
    gl.useProgram(prevProgram);
  }

  updateMood(moodUint8) {
    const gl = this.gl;
    const len = moodUint8.length;
    if (!this._moodFloat || this._moodFloat.length !== len) {
      this._moodFloat = new Float32Array(len);
    }
    for (let i = 0; i < len; i++) this._moodFloat[i] = moodUint8[i];
    gl.bindBuffer(gl.ARRAY_BUFFER, this.moodBuffer);
    if (len <= this._moodCap) {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this._moodFloat);
    } else {
      gl.bufferData(gl.ARRAY_BUFFER, this._moodFloat, gl.DYNAMIC_DRAW);
      this._moodCap = len;
    }
  }

  // Force-index order — must match _forceMags in boid-worker.js
  // (0=sep 1=ali 2=coh 3=bodySep 4=bodyAli 5=bodyCoh 6=edge)
  _uploadMoodColors(state) {
    const keys = WebGLBoidRenderer.MOOD_KEYS;
    let sig = '';
    for (let i = 0; i < keys.length; i++) sig += state[keys[i]] || '';
    if (sig === this._moodHexCache) return;   // unchanged — skip the parse
    this._moodHexCache = sig;
    for (let i = 0; i < keys.length; i++) {
      const h = (state[keys[i]] || '#ffffff').replace('#', '');
      this._moodRGB[i * 3]     = parseInt(h.slice(0, 2), 16) / 255;
      this._moodRGB[i * 3 + 1] = parseInt(h.slice(2, 4), 16) / 255;
      this._moodRGB[i * 3 + 2] = parseInt(h.slice(4, 6), 16) / 255;
    }
  }

  renderMood(canvasWidth, canvasHeight, pointSize, state) {
    if (this.count === 0) return;
    const gl = this.gl;
    const prevProgram = gl.getParameter(gl.CURRENT_PROGRAM);

    gl.useProgram(this.moodProgram);

    // Position attribute
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
    gl.enableVertexAttribArray(this.moodAPosition);
    gl.vertexAttribPointer(this.moodAPosition, 2, gl.FLOAT, false, 0, 0);

    // Mood attribute
    gl.bindBuffer(gl.ARRAY_BUFFER, this.moodBuffer);
    gl.enableVertexAttribArray(this.moodAMood);
    gl.vertexAttribPointer(this.moodAMood, 1, gl.FLOAT, false, 0, 0);

    gl.uniform2f(this.moodUResolution, canvasWidth, canvasHeight);
    gl.uniform1f(this.moodUPointSize, pointSize);
    this._uploadMoodColors(state);
    gl.uniform3fv(this.moodUColors, this._moodRGB);

    gl.drawArrays(gl.POINTS, 0, this.count);

    gl.disableVertexAttribArray(this.moodAPosition);
    gl.disableVertexAttribArray(this.moodAMood);

    gl.useProgram(prevProgram);
  }

  _compileProgram(vSrc, fSrc) {
    const gl = this.gl;
    const vs = this._compileShader(gl.VERTEX_SHADER, vSrc);
    const fs = this._compileShader(gl.FRAGMENT_SHADER, fSrc);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('Shader link error:', gl.getProgramInfoLog(prog));
    }
    return prog;
  }

  _compileShader(type, src) {
    const gl = this.gl;
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(s));
    }
    return s;
  }
}

// ─── 2D Debug Overlay (native Canvas 2D — independent of p5's GL) ─────


const KEYPOINT_NAMES = [
  'nose', 'L eye', 'R eye', 'L ear', 'R ear',
  'L shoulder', 'R shoulder', 'L elbow', 'R elbow',
  'L wrist', 'R wrist', 'L hip', 'R hip',
  'L knee', 'R knee', 'L ankle', 'R ankle',
];

// Each overlay's styling lives in state as <rKey>Color / <rKey>Alpha / <rKey>Width
// (Appearance → Interaction Radii); the fallbacks match the state.js defaults.
const RADIUS_CONFIGS = [
  { flag: 'showSeparationRadius', rKey: 'separationRadius', color: '#00c8ff', lw: 1 },
  { flag: 'showAlignmentRadius',  rKey: 'alignmentRadius',  color: '#00ff00', lw: 2 },
  { flag: 'showCohesionRadius',   rKey: 'cohesionRadius',   color: '#ffff00', lw: 2 },
];

export class DebugOverlay {
  constructor(width, height) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.canvas.style.cssText =
      'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:1;';
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
  }

  resize(width, height) {
    this.canvas.width = width;
    this.canvas.height = height;
  }

  render(positions, velocities, localCOMs, pathData, state, videoEl, videoTx, scaledPoses, gridAnalytics) {
    const ctx = this.ctx;
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    // Short-circuit: skip clear+redraw when nothing is visible on the overlay
    const hasVideo = state.showVideo && videoEl && videoEl.readyState >= 2 && videoTx;
    const hasSkeleton = state.showSkeleton && scaledPoses && scaledPoses.length > 0;
    const hasKeypoints = state.showActiveKeypoints && scaledPoses && scaledPoses.length > 0;
    const hasBoidDebug = state.showSeparationRadius || state.showAlignmentRadius ||
                         state.showCohesionRadius || state.showPath ||
                         state.showCenterOfMassLine;
    const hasGridViz = gridAnalytics && (state.showDensityHeatmap || state.showSpeedHeatmap || state.showVelocityFlowField);
    if (!hasVideo && !hasSkeleton && !hasKeypoints && !hasBoidDebug && !hasGridViz) {
      // Only clear if canvas was previously drawn on (avoid per-frame clear of empty canvas)
      if (this._wasDirty) {
        ctx.clearRect(0, 0, cw, ch);
        this._wasDirty = false;
      }
      return;
    }
    this._wasDirty = true;
    ctx.clearRect(0, 0, cw, ch);

    // Webcam feed (drawn first = behind everything)
    if (hasVideo) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      // Clip to canvas bounds (fill mode may overflow)
      ctx.beginPath();
      ctx.rect(0, 0, cw, ch);
      ctx.clip();
      if (state.webcamMirror) {
        ctx.translate(cw, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(videoEl, videoTx.offsetX, videoTx.offsetY, videoTx.scale * videoTx.vw, videoTx.scale * videoTx.vh);
      ctx.restore();
    }

    // Pose skeleton
    if (hasSkeleton) {
      this._drawSkeleton(ctx, scaledPoses);
    }

    // Active keypoints (the ones that interact with boids)
    if (hasKeypoints) {
      this._drawActiveKeypoints(ctx, scaledPoses, state);
    }

    // Grid-based visualizations
    if (hasGridViz) {
      if (state.showDensityHeatmap) this._drawDensityHeatmap(ctx, gridAnalytics, state);
      if (state.showSpeedHeatmap) this._drawSpeedHeatmap(ctx, gridAnalytics, state);
      if (state.showVelocityFlowField) this._drawVelocityFlowField(ctx, gridAnalytics, state);
    }

    if (!hasBoidDebug) return;

    const count = positions.length / 2;
    const TAU = Math.PI * 2;

    // Radius overlays
    for (const { flag, rKey, color, lw } of RADIUS_CONFIGS) {
      if (!state[flag]) continue;
      ctx.strokeStyle = state[rKey + 'Color'] || color;
      ctx.globalAlpha = state[rKey + 'Alpha'] ?? 0.39;
      ctx.lineWidth = state[rKey + 'Width'] ?? lw;
      // Radii are factors of boid size — mirror the worker's effective value
      const r = state[rKey] * (state.boidRadiiMult || 1) * boidBaseSize(state);
      for (let i = 0; i < count; i++) {
        ctx.beginPath();
        ctx.arc(positions[i * 2], positions[i * 2 + 1], r, 0, TAU);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // Path trails from history ring buffer (already sampled in main.js)
    if (state.showPath && pathData.ring.length > 1) {
      ctx.globalAlpha = state.pathAlpha ?? 0.4;
      ctx.strokeStyle = state.pathColor || '#ffffff';
      ctx.lineWidth = state.pathStrokeWidth ?? 1;
      const { ring, seq, birth } = pathData;
      const len = ring.length;
      const start = pathData.head % len;
      // Boid count from the NEWEST snapshot. It used to come from the oldest
      // (ring[start]), so a new boid got no trail until it had existed for the
      // whole ring (PATH_MAX frames) — trails popped in late and all at once.
      const newest = (start + len - 1) % len;
      const boidCount = ring[newest].length / 2;
      for (let bi = 0; bi < boidCount; bi++) {
        const born = birth[bi] ?? 0;
        ctx.beginPath();
        let started = false;
        for (let fi = 0; fi < len; fi++) {
          const k = (start + fi) % len;
          const snap = ring[k];
          // Skip frames before this boid existed, or that belong to an
          // earlier boid that held the same index
          if (seq[k] < born || snap.length <= bi * 2 + 1) continue;
          const px = snap[bi * 2];
          const py = snap[bi * 2 + 1];
          if (!started) { ctx.moveTo(px, py); started = true; }
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // Center-of-mass lines
    if (state.showCenterOfMassLine && localCOMs) {
      ctx.globalAlpha = state.comLineAlpha ?? 0.47;
      ctx.strokeStyle = state.comLineColor || '#ff0000';
      ctx.lineWidth = state.comLineWidth ?? 1.5;
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const cx = localCOMs[i * 2];
        const cy = localCOMs[i * 2 + 1];
        if (cx !== 0 || cy !== 0) {
          ctx.moveTo(positions[i * 2], positions[i * 2 + 1]);
          ctx.lineTo(cx, cy);
        }
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // Both heatmaps encode magnitude, so each is ONE hue with opacity carrying
  // the value — a sequential ramp. They used to sweep hue (blue→red /
  // violet→red), which reads as a rainbow: the colour implied categories that
  // weren't there, and the perceived ordering didn't match the data's.
  _rampCell(ctx, t, alphaMax) {
    // Floor so the lowest occupied cells stay visible rather than vanishing
    ctx.globalAlpha = alphaMax * (0.12 + 0.88 * t);
  }

  _drawDensityHeatmap(ctx, grid, state) {
    const { cols, rows, cellSize, density, maxDensity } = grid;
    if (maxDensity === 0) return;
    ctx.save();
    ctx.fillStyle = state.densityColor || '#3987e5';
    const aMax = state.densityAlpha ?? 0.35;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const d = density[r * cols + c];
        if (d === 0) continue;
        this._rampCell(ctx, d / maxDensity, aMax);
        ctx.fillRect(c * cellSize, r * cellSize, cellSize, cellSize);
      }
    }
    ctx.restore();
  }

  _drawSpeedHeatmap(ctx, grid, state) {
    const { cols, rows, cellSize, density, avgSpeed, maxSpeed } = grid;
    if (maxSpeed === 0) return;
    ctx.save();
    ctx.fillStyle = state.speedColor || '#eb6834';
    const aMax = state.speedAlpha ?? 0.35;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (density[idx] === 0) continue;
        this._rampCell(ctx, avgSpeed[idx] / maxSpeed, aMax);
        ctx.fillRect(c * cellSize, r * cellSize, cellSize, cellSize);
      }
    }
    ctx.restore();
  }

  _drawVelocityFlowField(ctx, grid, state) {
    const { cols, rows, cellSize, density, avgVelX, avgVelY } = grid;
    const half = cellSize / 2;
    const arrowLen = cellSize * (state.flowArrowScale ?? 0.4);
    const headLen = Math.max(2, arrowLen * 0.25);
    ctx.save();
    ctx.globalAlpha = state.flowAlpha ?? 0.6;
    ctx.strokeStyle = state.flowColor || '#ffffff';
    ctx.fillStyle = state.flowColor || '#ffffff';
    ctx.lineWidth = state.flowLineWidth ?? 1.5;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (density[idx] === 0) continue;
        const vx = avgVelX[idx];
        const vy = avgVelY[idx];
        const mag = Math.sqrt(vx * vx + vy * vy);
        if (mag < 0.01) continue;
        const nx = vx / mag;
        const ny = vy / mag;
        const cx = c * cellSize + half;
        const cy = r * cellSize + half;
        const ex = cx + nx * arrowLen;
        const ey = cy + ny * arrowLen;
        // Arrow line
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        // Arrowhead
        const angle = Math.atan2(ny, nx);
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - headLen * Math.cos(angle - 0.5), ey - headLen * Math.sin(angle - 0.5));
        ctx.lineTo(ex - headLen * Math.cos(angle + 0.5), ey - headLen * Math.sin(angle + 0.5));
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }

  _drawSkeleton(ctx, scaledPoses) {
    for (let pi = 0; pi < scaledPoses.length; pi++) {
      const kps = scaledPoses[pi].keypoints;

      const skelAlpha = state.skeletonAlpha ?? 0.5;

      // Draw bones
      ctx.globalAlpha = skelAlpha;
      ctx.strokeStyle = state.skeletonColor || '#ffffff';
      ctx.lineWidth = 2;
      for (const [a, b] of SKELETON_CONNECTIONS) {
        const kpA = kps[a];
        const kpB = kps[b];
        if (kpA && kpB && kpA.score > state.kpConfidence && kpB.score > state.kpConfidence) {
          ctx.beginPath();
          ctx.moveTo(kpA.x, kpA.y);
          ctx.lineTo(kpB.x, kpB.y);
          ctx.stroke();
        }
      }

      // Draw all joints as small dots
      ctx.globalAlpha = skelAlpha;
      ctx.fillStyle = state.skeletonColor || '#ffffff';
      for (let k = 0; k < kps.length; k++) {
        const kp = kps[k];
        if (kp && kp.score > state.kpConfidence) {
          ctx.beginPath();
          ctx.arc(kp.x, kp.y, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  _drawActiveKeypoints(ctx, scaledPoses, state) {
    const TAU = Math.PI * 2;
    const activeKps = getActiveKeypoints();
    const names = KEYPOINT_NAMES;

    const kpColor = state.keypointColor || '#ff6464';
    const kpAlpha = state.keypointAlpha ?? 1.0;

    for (let pi = 0; pi < scaledPoses.length; pi++) {
      const kps = scaledPoses[pi].keypoints;

      for (const k of activeKps) {
        const kp = kps[k];
        if (!kp || kp.score <= state.kpConfidence) continue;

        // Filled dot
        ctx.globalAlpha = kpAlpha;
        ctx.fillStyle = kpColor;
        ctx.beginPath();
        ctx.arc(kp.x, kp.y, 7, 0, TAU);
        ctx.fill();

        // Body interaction radius ring (kept fainter — 0.3× the dot opacity)
        ctx.globalAlpha = kpAlpha * 0.3;
        ctx.strokeStyle = kpColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(kp.x, kp.y,
          state.bodyCohesionRadius * (state.bodyRadiiMult || 1) * boidBaseSize(state), 0, TAU);
        ctx.stroke();

        // Label
        ctx.globalAlpha = kpAlpha;
        ctx.fillStyle = kpColor;
        ctx.font = '11px ui-monospace, monospace';
        ctx.fillText(names[k] || k, kp.x + 10, kp.y - 10);
      }
    }
    ctx.globalAlpha = 1; // reset so later overlays (radius circles) draw opaque
  }
}
