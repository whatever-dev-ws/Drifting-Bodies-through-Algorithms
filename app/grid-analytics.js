// grid-analytics.js — grid-based density, speed, and velocity analytics
// Shared computation for density heatmap, speed heatmap, and velocity flow field

export class GridAnalytics {
  constructor() {
    this.cols = 0;
    this.rows = 0;
    this.cellSize = 0;
    // Per-cell data (reused across frames)
    this.density = null;   // Float32Array — boid count per cell
    this.avgVelX = null;   // Float32Array — average velocity X per cell
    this.avgVelY = null;   // Float32Array — average velocity Y per cell
    this.avgSpeed = null;  // Float32Array — average speed per cell
    this.maxDensity = 0;
    this.maxSpeed = 0;
  }

  compute(positions, velocities, canvasW, canvasH, cellSize) {
    const cols = Math.ceil(canvasW / cellSize);
    const rows = Math.ceil(canvasH / cellSize);
    const total = cols * rows;

    this.cols = cols;
    this.rows = rows;
    this.cellSize = cellSize;

    // Ensure typed arrays are large enough (reuse to avoid GC)
    if (!this.density || this.density.length < total) {
      this.density = new Float32Array(total);
      this.avgVelX = new Float32Array(total);
      this.avgVelY = new Float32Array(total);
      this.avgSpeed = new Float32Array(total);
    }

    // Zero out
    this.density.fill(0, 0, total);
    this.avgVelX.fill(0, 0, total);
    this.avgVelY.fill(0, 0, total);
    this.avgSpeed.fill(0, 0, total);

    const count = positions.length / 2;

    // Single pass: accumulate per cell
    for (let i = 0; i < count; i++) {
      const px = positions[i * 2];
      const py = positions[i * 2 + 1];
      const col = Math.floor(px / cellSize);
      const row = Math.floor(py / cellSize);
      if (col < 0 || col >= cols || row < 0 || row >= rows) continue;

      const idx = row * cols + col;
      this.density[idx]++;
      const vx = velocities[i * 2];
      const vy = velocities[i * 2 + 1];
      this.avgVelX[idx] += vx;
      this.avgVelY[idx] += vy;
      this.avgSpeed[idx] += Math.sqrt(vx * vx + vy * vy);
    }

    // Normalize: divide sums by count, track maxima
    let maxD = 0;
    let maxS = 0;
    for (let i = 0; i < total; i++) {
      const d = this.density[i];
      if (d > 0) {
        this.avgVelX[i] /= d;
        this.avgVelY[i] /= d;
        this.avgSpeed[i] /= d;
        if (d > maxD) maxD = d;
        if (this.avgSpeed[i] > maxS) maxS = this.avgSpeed[i];
      }
    }
    this.maxDensity = maxD;
    this.maxSpeed = maxS;
  }
}
