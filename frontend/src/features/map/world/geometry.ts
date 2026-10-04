import { kindOf, tierOf, type Tier, type ZoneKind } from './theme';

export interface Pt {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Zone {
  /** The svg path id, which doubles as the territory's `svgPathId`. */
  id: string;
  /** Stable index into `Campus.zones`. */
  index: number;
  tier: Tier;
  kind: ZoneKind;
  /** Raw svg path data, kept so the canvas can build a `Path2D` from it. */
  d: string;
  /** Flattened outline (curves sampled). Implicitly closed. */
  poly: Pt[];
  box: Box;
  /** The point deepest inside the outline - label + travel target. */
  anchor: Pt;
  /** Horizontal room available around the anchor, for label fitting. */
  labelWidth: number;
  area: number;
  /** Small deterministic number in [0,1) for per-zone variation. */
  seed: number;
}

export interface Campus {
  width: number;
  height: number;
  zones: Zone[];
  byId: Map<string, Zone>;
}

const NUM_RE = /[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;
const CMD_RE = /([MmLlHhVvCcZz])([^MmLlHhVvCcZz]*)/g;

/** Flatten an svg path (absolute + relative M/L/H/V/C/Z) into one polygon. */
export function flattenPath(d: string): Pt[] {
  const pts: Pt[] = [];
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;

  for (const match of d.matchAll(CMD_RE)) {
    const cmd = match[1];
    const rel = cmd === cmd.toLowerCase();
    const upper = cmd.toUpperCase();
    const nums = (match[2].match(NUM_RE) ?? []).map(Number);

    if (upper === 'Z') {
      cx = sx;
      cy = sy;
      continue;
    }

    if (upper === 'M' || upper === 'L') {
      for (let i = 0; i + 1 < nums.length; i += 2) {
        cx = rel ? cx + nums[i] : nums[i];
        cy = rel ? cy + nums[i + 1] : nums[i + 1];
        if (upper === 'M' && i === 0) {
          sx = cx;
          sy = cy;
        }
        pts.push({ x: cx, y: cy });
      }
    } else if (upper === 'H') {
      for (const n of nums) {
        cx = rel ? cx + n : n;
        pts.push({ x: cx, y: cy });
      }
    } else if (upper === 'V') {
      for (const n of nums) {
        cy = rel ? cy + n : n;
        pts.push({ x: cx, y: cy });
      }
    } else if (upper === 'C') {
      for (let i = 0; i + 5 < nums.length; i += 6) {
        const x1 = rel ? cx + nums[i] : nums[i];
        const y1 = rel ? cy + nums[i + 1] : nums[i + 1];
        const x2 = rel ? cx + nums[i + 2] : nums[i + 2];
        const y2 = rel ? cy + nums[i + 3] : nums[i + 3];
        const x3 = rel ? cx + nums[i + 4] : nums[i + 4];
        const y3 = rel ? cy + nums[i + 5] : nums[i + 5];
        const steps = 10;
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          const u = 1 - t;
          pts.push({
            x: u * u * u * cx + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
            y: u * u * u * cy + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
          });
        }
        cx = x3;
        cy = y3;
      }
    }
  }

  // Drop a trailing point that merely repeats the start.
  if (pts.length > 2) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6) pts.pop();
  }
  return pts;
}

export function boundsOf(poly: Pt[]): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function polygonArea(poly: Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function pointInPolygon(x: number, y: number, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i];
    const pj = poly[j];
    if (pi.y > y !== pj.y > y && x < ((pj.x - pi.x) * (y - pi.y)) / (pj.y - pi.y) + pi.x) inside = !inside;
  }
  return inside;
}

export function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function distanceToPolygonEdge(x: number, y: number, poly: Pt[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const d = distanceToSegment(x, y, p.x, p.y, q.x, q.y);
    if (d < best) best = d;
  }
  return best;
}

/** Deepest interior point by grid sampling - robust for L-shapes and wedges. */
function computeAnchor(poly: Pt[], box: Box): Pt {
  const N = 26;
  let best: Pt = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  let bestDist = -1;
  for (let iy = 0; iy <= N; iy++) {
    for (let ix = 0; ix <= N; ix++) {
      const x = box.x + (box.w * (ix + 0.5)) / (N + 1);
      const y = box.y + (box.h * (iy + 0.5)) / (N + 1);
      if (!pointInPolygon(x, y, poly)) continue;
      const d = distanceToPolygonEdge(x, y, poly);
      if (d > bestDist) {
        bestDist = d;
        best = { x, y };
      }
    }
  }
  return best;
}

/** Width of the horizontal run of the polygon that contains (x, y). */
function horizontalSpan(poly: Pt[], x: number, y: number): number {
  const xs: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    if (p.y > y !== q.y > y) xs.push(p.x + ((y - p.y) / (q.y - p.y)) * (q.x - p.x));
  }
  xs.sort((a, b) => a - b);
  for (let i = 0; i + 1 < xs.length; i += 2) {
    if (x >= xs[i] && x <= xs[i + 1]) return xs[i + 1] - xs[i];
  }
  return 0;
}

function hashSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/** Parse the campus svg once into renderable zones. */
export function parseCampus(svgMarkup: string): Campus {
  const doc = new DOMParser().parseFromString(svgMarkup, 'image/svg+xml');
  const root = doc.documentElement;

  const viewBox = (root.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  const width = viewBox.length === 4 && viewBox[2] > 0 ? viewBox[2] : Number(root.getAttribute('width')) || 3018;
  const height = viewBox.length === 4 && viewBox[3] > 0 ? viewBox[3] : Number(root.getAttribute('height')) || 1597;

  const zones: Zone[] = [];
  doc.querySelectorAll('path[id]').forEach((el) => {
    const id = el.getAttribute('id') ?? '';
    const d = el.getAttribute('d') ?? '';
    if (!id || !d) return;

    const poly = flattenPath(d);
    if (poly.length < 3) return;
    const box = boundsOf(poly);
    const anchor = computeAnchor(poly, box);

    zones.push({
      id,
      index: zones.length,
      tier: tierOf(el.getAttribute('data-tier')),
      kind: kindOf(id),
      d,
      poly,
      box,
      anchor,
      labelWidth: horizontalSpan(poly, anchor.x, anchor.y),
      area: Math.abs(polygonArea(poly)),
      seed: hashSeed(id),
    });
  });

  const byId = new Map(zones.map((z) => [z.id, z]));
  return { width, height, zones, byId };
}

/** Topmost zone under a world point, or null. */
export function zoneAtPoint(campus: Campus, x: number, y: number): Zone | null {
  for (const z of campus.zones) {
    const b = z.box;
    if (x < b.x || y < b.y || x > b.x + b.w || y > b.y + b.h) continue;
    if (pointInPolygon(x, y, z.poly)) return z;
  }
  return null;
}
