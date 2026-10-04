// Zone outlines from the campus SVG. The functions here are deliberately the
// same as the ones the map uses to draw it (frontend/src/features/map/world/
// geometry.ts: flattenPath, boundsOf, polygonArea, pointInPolygon): the server
// decides where cells are with the very outline and bounding box the browser
// draws them in. A spec checks that the two agree on every zone.

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
            x:
              u * u * u * cx +
              3 * u * u * t * x1 +
              3 * u * t * t * x2 +
              t * t * t * x3,
            y:
              u * u * u * cy +
              3 * u * u * t * y1 +
              3 * u * t * t * y2 +
              t * t * t * y3,
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
  return Math.abs(a / 2);
}

export function pointInPolygon(x: number, y: number, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i];
    const pj = poly[j];
    if (
      pi.y > y !== pj.y > y &&
      x < ((pj.x - pi.x) * (y - pi.y)) / (pj.y - pi.y) + pi.x
    )
      inside = !inside;
  }
  return inside;
}

function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function distanceToPolygonEdge(
  x: number,
  y: number,
  poly: Pt[],
): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const d = distanceToSegment(x, y, p.x, p.y, q.x, q.y);
    if (d < best) best = d;
  }
  return best;
}

/** One zone of the campus: its SVG id, outline and bounding box. */
export interface ZoneShape {
  id: string;
  poly: Pt[];
  box: Box;
  area: number;
}

/** Reads every `<path id="…" d="…">` of the campus SVG, in document order. */
export function parseZones(svg: string): ZoneShape[] {
  const zones: ZoneShape[] = [];
  const pathRe = /<path\b[^>]*>/g;
  for (const tag of svg.match(pathRe) ?? []) {
    const id = /\sid="([^"]+)"/.exec(tag)?.[1];
    const d = /\sd="([^"]+)"/.exec(tag)?.[1];
    if (!id || !d) continue;
    const poly = flattenPath(d);
    if (poly.length < 3) continue;
    zones.push({ id, poly, box: boundsOf(poly), area: polygonArea(poly) });
  }
  return zones;
}
