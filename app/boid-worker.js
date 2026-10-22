// boid-worker.js — Web Worker for flocking simulation
// All flocking math runs off the main thread. Uses plain {x,y} objects, no p5.

import { SpatialGrid } from './spatial-grid.js';
import { boidBaseSize } from './state.js';

// ─── Lightweight Vector Math ───────────────────────────────────────────

const V = {
  setMag(v, m) {
    const cur = Math.sqrt(v.x * v.x + v.y * v.y) || 1;
    const c = m / cur;
    v.x *= c; v.y *= c;
  },
  limit(v, m) {
    if (v.x * v.x + v.y * v.y > m * m) V.setMag(v, m);
  },
  random2D() {
    const a = Math.random() * Math.PI * 2;
    return { x: Math.cos(a), y: Math.sin(a) };
  },
};

// Reusable steer output (avoid allocation in hot loop)
const _s = { x: 0, y: 0 };

// Steer: normalize desired vector to maxSpeed, subtract velocity, limit to maxForce
function steer(dx, dy, bvx, bvy, maxSpeed, maxForce) {
  const m = Math.sqrt(dx * dx + dy * dy);
  if (m < 1e-10) { _s.x = 0; _s.y = 0; return; }
  const c = maxSpeed / m;
  let sx = dx * c - bvx;
  let sy = dy * c - bvy;
  const sq = sx * sx + sy * sy;
  if (sq > maxForce * maxForce) {
    const sc = maxForce / Math.sqrt(sq);
    sx *= sc; sy *= sc;
  }
  _s.x = sx; _s.y = sy;
}

// ─── Boid Simulation ───────────────────────────────────────────────────

let boids = [];
let canvasW = 0;
let canvasH = 0;
const grid = new SpatialGrid(60);

// Double-buffered output arrays (transferable objects get neutered, so alternate)
let bufferSetA = { pos: null, vel: null, com: null, mood: null };
let bufferSetB = { pos: null, vel: null, com: null, mood: null };
let useSetA = true;

// Transferring a buffer to the main thread detaches it, and a detached typed
// array reads length 0. With a population of 0 that passes the length check,
// so the detached buffer was reused and transferred again → DataCloneError,
// no reply, and main.js stalled forever waiting on workerBusy. Zero-length
// arrays are therefore never reused (they cost nothing to allocate).
function reusable(arr, len) {
  return len > 0 && arr && arr.length === len;
}

function ensureBuffers(count, trackMood) {
  const size = count * 2;
  const set = useSetA ? bufferSetA : bufferSetB;
  if (!reusable(set.pos, size)) {
    set.pos = new Float32Array(size);
    set.vel = new Float32Array(size);
    set.com = new Float32Array(size);
  }
  if (trackMood && !reusable(set.mood, count)) {
    set.mood = new Uint8Array(count);
  }
  return set;
}

// Force magnitude indices: 0=sep, 1=ali, 2=coh, 3=bodySep, 4=bodyAli, 5=bodyCoh, 6=edge
const MOOD_COUNT = 7;

function createBoid(x, y) {
  const dir = V.random2D();
  const speed = 2 + Math.random() * 2;
  return {
    position: { x, y },
    velocity: { x: dir.x * speed, y: dir.y * speed },
    acceleration: { x: 0, y: 0 },
    baseMaxForce: 0.05,
    maxForce: 0.05,
    maxSpeed: 3,
    localCOM: { x: 0, y: 0 },
    _forceMags: new Float32Array(MOOD_COUNT),
  };
}

// ─── Fused single-pass flocking (boid↔boid) ──────────────────────────
// Computes separation, alignment, and cohesion in one loop over neighbors,
// with one distance computation per neighbor instead of three.

function flockWithBoids(boid, neighbors, state, trackMood) {
  // Radii are factors of boid size — see boidBaseSize() in state.js
  const rm = (state.boidRadiiMult || 1) * boidBaseSize(state);
  const sepR = state.separationRadius * rm;
  const aliR = state.alignmentRadius * rm;
  const cohR = state.cohesionRadius * rm;
  const sepRSq = sepR * sepR;
  const aliRSq = aliR * aliR;
  const cohRSq = cohR * cohR;
  const maxRSq = Math.max(sepRSq, aliRSq, cohRSq);

  const bx = boid.position.x, by = boid.position.y;
  const bvx = boid.velocity.x, bvy = boid.velocity.y;
  const maxSpeed = boid.maxSpeed;
  const maxForce = boid.maxForce;

  // Accumulators
  let sepX = 0, sepY = 0, sepCount = 0;
  let aliX = 0, aliY = 0, aliCount = 0;
  let cohX = 0, cohY = 0, cohCount = 0;

  // ?? not ||: 0 is a real setting (no flocking neighbours), not "unset"
  const maxNeighbours = state.maxNeighbours ?? 50;
  let validCount = 0;

  for (let i = 0; i < neighbors.length; i++) {
    const other = neighbors[i];
    if (other === boid) continue;
    const dx = other.position.x - bx;
    const dy = other.position.y - by;
    const distSq = dx * dx + dy * dy;

    if (distSq >= maxRSq || distSq === 0) continue;

    if (++validCount > maxNeighbours) break;

    if (distSq < sepRSq) {
      const invD = 1 / Math.sqrt(distSq);
      // diff normalized * (1/d) = diff / d^2 effectively
      sepX += (-dx * invD) * invD;
      sepY += (-dy * invD) * invD;
      sepCount++;
    }
    if (distSq < aliRSq) {
      aliX += other.velocity.x;
      aliY += other.velocity.y;
      aliCount++;
    }
    if (distSq < cohRSq) {
      cohX += other.position.x;
      cohY += other.position.y;
      cohCount++;
    }
  }

  // Separation force
  const wm = state.boidWeightsMult || 1;
  if (sepCount > 0) {
    steer(sepX / sepCount, sepY / sepCount, bvx, bvy, maxSpeed, maxForce);
    const wx = _s.x * state.separationWeight * wm, wy = _s.y * state.separationWeight * wm;
    boid.acceleration.x += wx; boid.acceleration.y += wy;
    if (trackMood) boid._forceMags[0] += Math.sqrt(wx * wx + wy * wy);
  }

  // Alignment force
  if (aliCount > 0) {
    steer(aliX / aliCount, aliY / aliCount, bvx, bvy, maxSpeed, maxForce);
    const wx = _s.x * state.alignmentWeight * wm, wy = _s.y * state.alignmentWeight * wm;
    boid.acceleration.x += wx; boid.acceleration.y += wy;
    if (trackMood) boid._forceMags[1] += Math.sqrt(wx * wx + wy * wy);
  }

  // Cohesion force (seek toward local center of mass)
  if (cohCount > 0) {
    cohX /= cohCount; cohY /= cohCount;
    boid.localCOM.x = cohX;
    boid.localCOM.y = cohY;
    steer(cohX - bx, cohY - by, bvx, bvy, maxSpeed, maxForce);
    const wx = _s.x * state.cohesionWeight * wm, wy = _s.y * state.cohesionWeight * wm;
    boid.acceleration.x += wx; boid.acceleration.y += wy;
    if (trackMood) boid._forceMags[2] += Math.sqrt(wx * wx + wy * wy);
  } else {
    boid.localCOM.x = 0;
    boid.localCOM.y = 0;
  }
}

// ─── Fused single-pass flocking (boid↔body) ──────────────────────────

function flockWithBody(boid, agents, agentCount, state, trackMood) {
  if (agentCount === 0) return;

  // Radii are factors of boid size — see boidBaseSize() in state.js
  const brm = (state.bodyRadiiMult || 1) * boidBaseSize(state);
  const baseSepR = state.bodySeparationRadius * brm;
  const baseAliR = state.bodyAlignmentRadius * brm;
  const baseCohR = state.bodyCohesionRadius * brm;

  const bx = boid.position.x, by = boid.position.y;
  const bvx = boid.velocity.x, bvy = boid.velocity.y;
  const maxSpeed = boid.maxSpeed;
  const maxForce = boid.maxForce;

  let sepX = 0, sepY = 0, sepCount = 0;
  let aliX = 0, aliY = 0, aliCount = 0;
  let cohX = 0, cohY = 0, cohCount = 0;
  let sepWeightSum = 0, aliWeightSum = 0, cohWeightSum = 0;

  for (let i = 0; i < agentCount; i++) {
    const base = i * 6;
    const ax = agents[base], ay = agents[base + 1];
    const avx = agents[base + 2], avy = agents[base + 3];
    const weightMult = agents[base + 4];
    const radiusMult = agents[base + 5];
    if (weightMult <= 0) continue; // joint weighted out — contributes nothing
    const dx = ax - bx;
    const dy = ay - by;
    const distSq = dx * dx + dy * dy;

    const rmSq = radiusMult * radiusMult;
    const sepRSq = baseSepR * baseSepR * rmSq;
    const aliRSq = baseAliR * baseAliR * rmSq;
    const cohRSq = baseCohR * baseCohR * rmSq;
    const maxRSq = Math.max(sepRSq, aliRSq, cohRSq);

    if (distSq >= maxRSq || distSq === 0) continue;

    if (distSq < sepRSq) {
      const invD = 1 / Math.sqrt(distSq);
      sepX += (-dx * invD) * invD * weightMult;
      sepY += (-dy * invD) * invD * weightMult;
      sepWeightSum += weightMult;
      sepCount++;
    }
    if (distSq < aliRSq) {
      aliX += avx * weightMult;
      aliY += avy * weightMult;
      aliWeightSum += weightMult;
      aliCount++;
    }
    if (distSq < cohRSq) {
      cohX += ax * weightMult;
      cohY += ay * weightMult;
      cohWeightSum += weightMult;
      cohCount++;
    }
  }

  const bwm = state.bodyWeightsMult || 1;
  if (sepCount > 0) {
    steer(sepX / sepWeightSum, sepY / sepWeightSum, bvx, bvy, maxSpeed, maxForce);
    const wx = _s.x * state.bodySeparationWeight * bwm, wy = _s.y * state.bodySeparationWeight * bwm;
    boid.acceleration.x += wx; boid.acceleration.y += wy;
    if (trackMood) boid._forceMags[3] += Math.sqrt(wx * wx + wy * wy);
  }

  if (aliCount > 0) {
    steer(aliX / aliWeightSum, aliY / aliWeightSum, bvx, bvy, maxSpeed, maxForce);
    const wx = _s.x * state.bodyAlignmentWeight * bwm, wy = _s.y * state.bodyAlignmentWeight * bwm;
    boid.acceleration.x += wx; boid.acceleration.y += wy;
    if (trackMood) boid._forceMags[4] += Math.sqrt(wx * wx + wy * wy);
  }

  if (cohCount > 0) {
    cohX /= cohWeightSum; cohY /= cohWeightSum;
    steer(cohX - bx, cohY - by, bvx, bvy, maxSpeed, maxForce);
    const wx = _s.x * state.bodyCohesionWeight * bwm, wy = _s.y * state.bodyCohesionWeight * bwm;
    boid.acceleration.x += wx; boid.acceleration.y += wy;
    if (trackMood) boid._forceMags[5] += Math.sqrt(wx * wx + wy * wy);
  }
}

// ─── Edge avoidance & update ──────────────────────────────────────────

function mapRange(value, start1, stop1, start2, stop2) {
  return start2 + (stop2 - start2) * ((value - start1) / (stop1 - start1));
}

function edgeAvoidance(boid, state, trackMood) {
  const margin = state.edgeMargin ?? 100;
  const strength = boid.maxForce * (state.edgeStrength ?? 5);
  if (margin <= 0 || strength <= 0) return; // repulsion off — boids drift off-canvas
  let fx = 0, fy = 0;

  if (boid.position.x < margin) {
    fx = mapRange(boid.position.x, 0, margin, strength, 0);
  } else if (boid.position.x > canvasW - margin) {
    fx = mapRange(boid.position.x, canvasW, canvasW - margin, -strength, 0);
  }

  if (boid.position.y < margin) {
    fy = mapRange(boid.position.y, 0, margin, strength, 0);
  } else if (boid.position.y > canvasH - margin) {
    fy = mapRange(boid.position.y, canvasH, canvasH - margin, -strength, 0);
  }

  // Inline limit
  const sq = fx * fx + fy * fy;
  if (sq > strength * strength) {
    const s = strength / Math.sqrt(sq);
    fx *= s; fy *= s;
  }

  boid.acceleration.x += fx;
  boid.acceleration.y += fy;
  if (trackMood) boid._forceMags[6] += Math.sqrt(fx * fx + fy * fy);
}

function updateBoid(boid, dt) {
  boid.velocity.x += boid.acceleration.x * dt;
  boid.velocity.y += boid.acceleration.y * dt;
  V.limit(boid.velocity, boid.maxSpeed);

  boid.position.x += boid.velocity.x * dt;
  boid.position.y += boid.velocity.y * dt;

  boid.acceleration.x = 0;
  boid.acceleration.y = 0;
}

// ─── Worker Message Handler ────────────────────────────────────────────

// Cache last state to avoid re-sending unchanged state
let cachedState = null;

onmessage = function (e) {
  const msg = e.data;
  if (msg.type !== 'simulate') return;

  const { bodyAgents, bodyAgentCount, canvasWidth, canvasHeight, deltaTime } = msg;
  // Use new state if provided, otherwise keep cached
  if (msg.state) cachedState = msg.state;
  const state = cachedState;
  if (!state) return;

  canvasW = canvasWidth;
  canvasH = canvasHeight;

  const dt = deltaTime || 1;

  // Maintain boid population
  const desired = state.boidCount;
  while (boids.length < desired) {
    boids.push(createBoid(Math.random() * canvasW, Math.random() * canvasH));
  }
  if (boids.length > desired) {
    boids.length = desired;
  }

  // Rebuild spatial grid with dynamic cell size matching max query radius
  // Must match the effective radii computed above, or the grid under-queries
  const brmGrid = (state.boidRadiiMult || 1) * boidBaseSize(state);
  const maxR = Math.max(state.separationRadius, state.alignmentRadius, state.cohesionRadius) * brmGrid;
  const cellSize = Math.max(maxR, 20); // floor to avoid tiny cells
  grid.resize(cellSize);
  grid.clear();
  for (let i = 0; i < boids.length; i++) {
    grid.insert(boids[i], boids[i].position);
  }

  // Mood tracking
  const trackMood = !!state.showMoodColoring;

  // Update all boids
  for (let i = 0; i < boids.length; i++) {
    const b = boids[i];
    b.maxSpeed = state.globalMaxSpeed;
    b.maxForce = b.baseMaxForce * state.globalForceMult;

    if (trackMood) b._forceMags.fill(0);

    const neighbors = grid.neighbors(b.position, maxR);
    flockWithBoids(b, neighbors, state, trackMood);
    flockWithBody(b, bodyAgents, bodyAgentCount, state, trackMood);
    edgeAvoidance(b, state, trackMood);
    updateBoid(b, dt);
  }

  // Pack results into reusable typed arrays (double-buffered)
  const count = boids.length;
  const bufSet = ensureBuffers(count, trackMood);
  const posArr = bufSet.pos;
  const velArr = bufSet.vel;
  const comArr = bufSet.com;

  for (let i = 0; i < count; i++) {
    const b = boids[i];
    const i2 = i * 2;
    posArr[i2]     = b.position.x;
    posArr[i2 + 1] = b.position.y;
    velArr[i2]     = b.velocity.x;
    velArr[i2 + 1] = b.velocity.y;
    comArr[i2]     = b.localCOM.x;
    comArr[i2 + 1] = b.localCOM.y;
  }

  // Compute dominant mood (argmax of force magnitudes)
  let moodArr = null;
  if (trackMood) {
    moodArr = bufSet.mood;
    for (let i = 0; i < count; i++) {
      const fm = boids[i]._forceMags;
      let maxVal = fm[0], maxIdx = 0;
      for (let j = 1; j < MOOD_COUNT; j++) {
        if (fm[j] > maxVal) { maxVal = fm[j]; maxIdx = j; }
      }
      moodArr[i] = maxIdx;
    }
  }

  // Alternate buffer set for next frame (current ones get neutered by transfer)
  useSetA = !useSetA;

  // Transfer buffers (zero-copy)
  const out = { type: 'result', positions: posArr, velocities: velArr, localCOMs: comArr };
  const transfers = [posArr.buffer, velArr.buffer, comArr.buffer];
  if (moodArr) {
    out.mood = moodArr;
    transfers.push(moodArr.buffer);
  }
  postMessage(out, transfers);
};
