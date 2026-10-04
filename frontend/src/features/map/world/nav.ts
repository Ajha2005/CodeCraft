import { pointInPolygon, type Campus, type Pt, type Zone } from './geometry';

// A coarse walkability grid laid over the campus. It gives the avatar three
// things: (1) a cheap "which zone am I standing in" lookup, (2) obstacles it
// must walk around (the pond, the campus edge), and (3) a cost field so that
// click-to-travel prefers streets over cutting through every building -
// which is what makes movement read as *navigating* a place.

export const NAV_CELL = 10;
/** Walkable border around the campus rectangle, in world units. */
export const NAV_MARGIN = 24;

const COST_STREET = 1;
const COST_OPEN = 1.12; // fields, tracks, plazas, parking: pleasant to cross
const COST_FOREST = 1.7;
const COST_BUILDING = 2.4;

const SQRT2 = Math.SQRT2;

export interface LaneMark {
  x: number;
  y: number;
  /** 'h' = dash runs horizontally (a horizontal corridor), 'v' = vertical. */
  dir: 'h' | 'v';
  /** Half-width of the street at this point, world units. */
  half: number;
}

class MinHeap {
  private idx: number[] = [];
  private score: number[] = [];

  get size() {
    return this.idx.length;
  }

  push(i: number, f: number) {
    this.idx.push(i);
    this.score.push(f);
    let c = this.idx.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (this.score[p] <= this.score[c]) break;
      this.swap(p, c);
      c = p;
    }
  }

  pop(): number {
    const top = this.idx[0];
    const lastI = this.idx.pop() as number;
    const lastS = this.score.pop() as number;
    if (this.idx.length > 0) {
      this.idx[0] = lastI;
      this.score[0] = lastS;
      let p = 0;
      const n = this.idx.length;
      for (;;) {
        const l = p * 2 + 1;
        const r = l + 1;
        let m = p;
        if (l < n && this.score[l] < this.score[m]) m = l;
        if (r < n && this.score[r] < this.score[m]) m = r;
        if (m === p) break;
        this.swap(p, m);
        p = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number) {
    [this.idx[a], this.idx[b]] = [this.idx[b], this.idx[a]];
    [this.score[a], this.score[b]] = [this.score[b], this.score[a]];
  }
}

export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  /** Per-cell traversal cost; 0 means blocked. */
  readonly cost: Float32Array;
  /** Index into Campus.zones, or -1 for open ground. */
  readonly zoneIdx: Int16Array;
  /** Distance (world units) from each cell to the nearest zone; 0 inside one. */
  readonly dist: Float32Array;

  private readonly originX = -NAV_MARGIN;
  private readonly originY = -NAV_MARGIN;

  private readonly campus: Campus;

  constructor(campus: Campus) {
    this.campus = campus;
    this.cols = Math.ceil((campus.width + NAV_MARGIN * 2) / NAV_CELL);
    this.rows = Math.ceil((campus.height + NAV_MARGIN * 2) / NAV_CELL);
    const n = this.cols * this.rows;
    this.cost = new Float32Array(n).fill(COST_STREET);
    this.zoneIdx = new Int16Array(n).fill(-1);
    this.dist = new Float32Array(n);

    this.rasterizeZones();
    this.computeDistanceField();
  }

  private rasterizeZones() {
    // Later zones win ties, matching zoneAtPoint's top-down scan closely
    // enough for this purpose (zones do not overlap in the source svg).
    for (const zone of this.campus.zones) {
      const b = zone.box;
      const gx0 = Math.max(0, Math.floor((b.x - this.originX) / NAV_CELL));
      const gx1 = Math.min(this.cols - 1, Math.ceil((b.x + b.w - this.originX) / NAV_CELL));
      const gy0 = Math.max(0, Math.floor((b.y - this.originY) / NAV_CELL));
      const gy1 = Math.min(this.rows - 1, Math.ceil((b.y + b.h - this.originY) / NAV_CELL));

      for (let gy = gy0; gy <= gy1; gy++) {
        for (let gx = gx0; gx <= gx1; gx++) {
          const x = this.originX + gx * NAV_CELL + NAV_CELL / 2;
          const y = this.originY + gy * NAV_CELL + NAV_CELL / 2;
          if (!pointInPolygon(x, y, zone.poly)) continue;
          const i = gy * this.cols + gx;
          this.zoneIdx[i] = zone.index;
          this.cost[i] = this.costFor(zone);
        }
      }
    }

    // The pond is an obstacle; everything past the campus edge is too.
    const pond = this.campus.byId.get('waterbody');
    for (let gy = 0; gy < this.rows; gy++) {
      for (let gx = 0; gx < this.cols; gx++) {
        const i = gy * this.cols + gx;
        const x = this.originX + gx * NAV_CELL + NAV_CELL / 2;
        const y = this.originY + gy * NAV_CELL + NAV_CELL / 2;
        const outside = x < -NAV_MARGIN + NAV_CELL || y < -NAV_MARGIN + NAV_CELL || x > this.campus.width + NAV_MARGIN - NAV_CELL || y > this.campus.height + NAV_MARGIN - NAV_CELL;
        if (outside) this.cost[i] = 0;
        else if (pond && this.zoneIdx[i] === pond.index) this.cost[i] = 0;
      }
    }
  }

  private costFor(zone: Zone): number {
    switch (zone.kind) {
      case 'forest':
        return COST_FOREST;
      case 'field':
      case 'track':
      case 'court':
      case 'plaza':
      case 'parking':
      case 'gate':
        return COST_OPEN;
      case 'water':
        return COST_OPEN; // overridden to blocked in rasterizeZones
      default:
        return COST_BUILDING;
    }
  }

  /** Chamfer distance transform: how far is each cell from the nearest zone. */
  private computeDistanceField() {
    const { cols, rows, dist, zoneIdx } = this;
    const INF = 1e6;
    for (let i = 0; i < dist.length; i++) dist[i] = zoneIdx[i] >= 0 ? 0 : INF;

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        let d = dist[i];
        if (x > 0) d = Math.min(d, dist[i - 1] + 1);
        if (y > 0) {
          d = Math.min(d, dist[i - cols] + 1);
          if (x > 0) d = Math.min(d, dist[i - cols - 1] + SQRT2);
          if (x < cols - 1) d = Math.min(d, dist[i - cols + 1] + SQRT2);
        }
        dist[i] = d;
      }
    }
    for (let y = rows - 1; y >= 0; y--) {
      for (let x = cols - 1; x >= 0; x--) {
        const i = y * cols + x;
        let d = dist[i];
        if (x < cols - 1) d = Math.min(d, dist[i + 1] + 1);
        if (y < rows - 1) {
          d = Math.min(d, dist[i + cols] + 1);
          if (x < cols - 1) d = Math.min(d, dist[i + cols + 1] + SQRT2);
          if (x > 0) d = Math.min(d, dist[i + cols - 1] + SQRT2);
        }
        dist[i] = d;
      }
    }
    for (let i = 0; i < dist.length; i++) dist[i] *= NAV_CELL;
  }

  // ---- coordinates -------------------------------------------------------

  private gx(x: number) {
    return Math.floor((x - this.originX) / NAV_CELL);
  }
  private gy(y: number) {
    return Math.floor((y - this.originY) / NAV_CELL);
  }
  private inGrid(gx: number, gy: number) {
    return gx >= 0 && gy >= 0 && gx < this.cols && gy < this.rows;
  }
  private cellCenter(i: number): Pt {
    const gx = i % this.cols;
    const gy = (i - gx) / this.cols;
    return { x: this.originX + gx * NAV_CELL + NAV_CELL / 2, y: this.originY + gy * NAV_CELL + NAV_CELL / 2 };
  }

  isWalkable(x: number, y: number): boolean {
    const gx = this.gx(x);
    const gy = this.gy(y);
    return this.inGrid(gx, gy) && this.cost[gy * this.cols + gx] > 0;
  }

  zoneIndexAt(x: number, y: number): number {
    const gx = this.gx(x);
    const gy = this.gy(y);
    return this.inGrid(gx, gy) ? this.zoneIdx[gy * this.cols + gx] : -1;
  }

  costAt(x: number, y: number): number {
    const gx = this.gx(x);
    const gy = this.gy(y);
    return this.inGrid(gx, gy) ? this.cost[gy * this.cols + gx] : 0;
  }

  /** Closest walkable point to (x, y), searching outward in rings. */
  nearestWalkable(x: number, y: number): Pt {
    if (this.isWalkable(x, y)) return { x, y };
    const cx = this.gx(x);
    const cy = this.gy(y);
    for (let r = 1; r < Math.max(this.cols, this.rows); r++) {
      let best: Pt | null = null;
      let bestD = Infinity;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const gx = cx + dx;
          const gy = cy + dy;
          if (!this.inGrid(gx, gy) || this.cost[gy * this.cols + gx] <= 0) continue;
          const c = this.cellCenter(gy * this.cols + gx);
          const d = Math.hypot(c.x - x, c.y - y);
          if (d < bestD) {
            bestD = d;
            best = c;
          }
        }
      }
      if (best) return best;
    }
    return { x, y };
  }

  // ---- pathfinding -------------------------------------------------------

  /** Weighted A* then cost-aware string pulling. Returns waypoints incl. endpoints. */
  findPath(from: Pt, to: Pt): Pt[] {
    const start = this.nearestWalkable(from.x, from.y);
    const goal = this.nearestWalkable(to.x, to.y);
    const sx = Math.max(0, Math.min(this.cols - 1, this.gx(start.x)));
    const sy = Math.max(0, Math.min(this.rows - 1, this.gy(start.y)));
    const tx = Math.max(0, Math.min(this.cols - 1, this.gx(goal.x)));
    const ty = Math.max(0, Math.min(this.rows - 1, this.gy(goal.y)));
    const startI = sy * this.cols + sx;
    const goalI = ty * this.cols + tx;

    if (startI === goalI) return [{ x: from.x, y: from.y }, { x: goal.x, y: goal.y }];

    const n = this.cols * this.rows;
    const g = new Float32Array(n).fill(Infinity);
    const parent = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const open = new MinHeap();

    const h = (i: number) => {
      const dx = Math.abs((i % this.cols) - tx);
      const dy = Math.abs(Math.floor(i / this.cols) - ty);
      return (Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy)) * COST_STREET;
    };

    g[startI] = 0;
    open.push(startI, h(startI));

    while (open.size > 0) {
      const cur = open.pop();
      if (closed[cur]) continue;
      closed[cur] = 1;
      if (cur === goalI) break;

      const cx = cur % this.cols;
      const cy = (cur - cx) / this.cols;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (!this.inGrid(nx, ny)) continue;
          const ni = ny * this.cols + nx;
          const nc = this.cost[ni];
          if (nc <= 0 || closed[ni]) continue;
          if (dx !== 0 && dy !== 0) {
            // no squeezing diagonally between two blocked corners
            if (this.cost[cy * this.cols + nx] <= 0 || this.cost[ny * this.cols + cx] <= 0) continue;
          }
          const step = (dx !== 0 && dy !== 0 ? SQRT2 : 1) * ((this.cost[cur] + nc) / 2);
          const ng = g[cur] + step;
          if (ng < g[ni]) {
            g[ni] = ng;
            parent[ni] = cur;
            open.push(ni, ng + h(ni));
          }
        }
      }
    }

    if (parent[goalI] === -1) return [{ x: from.x, y: from.y }, { x: goal.x, y: goal.y }];

    const nodes: number[] = [];
    for (let i = goalI; i !== -1; i = parent[i]) nodes.push(i);
    nodes.reverse();

    const pts: Pt[] = nodes.map((i) => this.cellCenter(i));
    pts[0] = { x: from.x, y: from.y };
    pts[pts.length - 1] = { x: goal.x, y: goal.y };

    const cum = nodes.map((i) => g[i] * NAV_CELL);
    return this.pull(pts, cum);
  }

  /** Cost of walking the straight segment a->b, or Infinity if blocked. */
  private lineCost(a: Pt, b: Pt): number {
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    if (dist < 1e-6) return 0;
    const step = NAV_CELL * 0.4;
    const n = Math.max(1, Math.ceil(dist / step));
    let total = 0;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const c = this.costAt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
      if (c <= 0) return Infinity;
      total += c * (dist / n);
    }
    return total;
  }

  /**
   * Greedy string pulling that only accepts a shortcut when the straight
   * line is no more expensive than the A* route it replaces. That keeps the
   * street preference intact instead of "smoothing" straight through blocks.
   */
  private pull(pts: Pt[], cum: number[]): Pt[] {
    const out: Pt[] = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let next = i + 1;
      for (let j = pts.length - 1; j > i + 1; j--) {
        const straight = this.lineCost(pts[i], pts[j]);
        if (straight <= (cum[j] - cum[i]) * 1.04 + 1) {
          next = j;
          break;
        }
      }
      out.push(pts[next]);
      i = next;
    }
    return out;
  }

  // ---- street dressing ---------------------------------------------------

  /**
   * Centerline dashes for the gaps between blocks. A cell is on a street's
   * spine when its distance-to-nearest-building is a local maximum across the
   * corridor, which finds the middle of any reasonably narrow gap without
   * hand-authored road data.
   */
  laneMarks(minHalf = 4, maxHalf = 34): LaneMark[] {
    const { cols, rows, dist, zoneIdx } = this;
    const marks: LaneMark[] = [];
    const W = this.campus.width;
    const H = this.campus.height;

    for (let gy = 1; gy < rows - 1; gy++) {
      for (let gx = 1; gx < cols - 1; gx++) {
        const i = gy * cols + gx;
        if (zoneIdx[i] >= 0 || this.cost[i] <= 0) continue;
        const d = dist[i];
        if (d < minHalf || d > maxHalf) continue;

        const c = this.cellCenter(i);
        if (c.x < 6 || c.y < 6 || c.x > W - 6 || c.y > H - 6) continue;

        const up = dist[i - cols];
        const down = dist[i + cols];
        const left = dist[i - 1];
        const right = dist[i + 1];

        // Ridge across a horizontal corridor: peak in y, flat along x.
        const ridgeY = d >= up && d > down && Math.abs(left - d) < NAV_CELL * 0.6 && Math.abs(right - d) < NAV_CELL * 0.6;
        const ridgeX = d >= left && d > right && Math.abs(up - d) < NAV_CELL * 0.6 && Math.abs(down - d) < NAV_CELL * 0.6;

        if (ridgeY) marks.push({ x: c.x, y: c.y, dir: 'h', half: d });
        else if (ridgeX) marks.push({ x: c.x, y: c.y, dir: 'v', half: d });
      }
    }
    return marks;
  }
}
