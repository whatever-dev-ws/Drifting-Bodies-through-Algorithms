// spatial-grid.js — grid-based spatial partitioning for neighbor lookup
// Pure data structure, no p5 dependency

export class SpatialGrid {
  constructor(cell = 60) {
    this.cell = cell;
    this.map = new Map();
    this._out = [];
  }

  clear() {
    this.map.clear();
  }

  resize(cell) {
    this.cell = cell;
  }

  insert(obj, pos) {
    const k = this._key(pos.x, pos.y);
    let bucket = this.map.get(k);
    if (!bucket) {
      bucket = [];
      this.map.set(k, bucket);
    }
    bucket.push(obj);
  }

  neighbors(pos, radius) {
    const c = this.cell;
    const minx = Math.floor((pos.x - radius) / c);
    const maxx = Math.floor((pos.x + radius) / c);
    const miny = Math.floor((pos.y - radius) / c);
    const maxy = Math.floor((pos.y + radius) / c);
    const out = this._out;
    out.length = 0;
    for (let gx = minx; gx <= maxx; gx++) {
      for (let gy = miny; gy <= maxy; gy++) {
        const k = (gx * 73856093) ^ (gy * 19349663);
        const arr = this.map.get(k);
        if (arr) {
          for (let j = 0; j < arr.length; j++) out.push(arr[j]);
        }
      }
    }
    return out;
  }

  _key(x, y) {
    const gx = Math.floor(x / this.cell);
    const gy = Math.floor(y / this.cell);
    return (gx * 73856093) ^ (gy * 19349663);
  }
}
