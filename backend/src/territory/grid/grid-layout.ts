import { MIN_CELLS_PER_ZONE, TOTAL_CELLS } from './grid.config';
import {
  Box,
  ZoneShape,
  distanceToPolygonEdge,
  pointInPolygon,
} from './svg-geometry';

/**
 * Lays out the campus map's cells.
 *
 * Every zone gets a share of TOTAL_CELLS in proportion to its area (largest
 * remainder, never less than MIN_CELLS_PER_ZONE), and its own grid of exactly
 * that many cells: a rows x cols lattice over the zone's bounding box, keeping
 * the cells whose centre is inside the outline, nudged to the exact number by
 * dropping the most marginal cells. The map draws a zone's cells the same way:
 * cell (row, col) sits at box.x + col * box.w / cols, box.y + row * box.h / rows,
 * where rows and cols are the highest row and column in use plus one. So the
 * grid keeps its first and last row and column occupied.
 */

export interface LayoutCell {
  row: number;
  col: number;
  /** Centre of the cell, in map units. */
  cx: number;
  cy: number;
}

export interface ZoneGrid {
  zoneId: string;
  box: Box;
  rows: number;
  cols: number;
  cells: LayoutCell[];
}

export interface CampusGrid {
  total: number;
  zones: ZoneGrid[];
}

/**
 * Splits `total` over zones by their areas: largest remainder, with a floor of
 * `min` per zone. Ties go to the earlier zone, so the result is deterministic.
 */
export function allocateCells(
  areas: number[],
  total: number = TOTAL_CELLS,
  min: number = MIN_CELLS_PER_ZONE,
): number[] {
  if (areas.length === 0) return [];
  if (total < areas.length * min)
    throw new Error(
      `Cannot give ${areas.length} zones at least ${min} cell(s) each out of ${total}`,
    );
  const sum = areas.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) throw new Error('Zone areas must add up to more than zero');

  const quota = areas.map((area) => (total * area) / sum);
  const counts = quota.map((q) => Math.max(min, Math.floor(q)));
  let missing = total - counts.reduce((a, b) => a + b, 0);

  // Hand out what is missing to whoever is furthest below their quota ...
  while (missing > 0) {
    let best = 0;
    for (let i = 1; i < counts.length; i++)
      if (quota[i] - counts[i] > quota[best] - counts[best]) best = i;
    counts[best] += 1;
    missing -= 1;
  }
  // ... and take back what the minimum added from whoever is furthest above theirs.
  while (missing < 0) {
    let best = -1;
    for (let i = 0; i < counts.length; i++) {
      if (
        counts[i] > min &&
        (best === -1 || counts[i] - quota[i] > counts[best] - quota[best])
      )
        best = i;
    }
    if (best === -1)
      throw new Error('Cannot reduce the allocation any further');
    counts[best] -= 1;
    missing += 1;
  }
  return counts;
}

const keyOf = (row: number, col: number) => row * 100_000 + col;

function componentCount(cells: LayoutCell[]): number {
  const left = new Set(cells.map((c) => keyOf(c.row, c.col)));
  let components = 0;
  for (const cell of cells) {
    const start = keyOf(cell.row, cell.col);
    if (!left.has(start)) continue;
    components += 1;
    const stack = [cell];
    left.delete(start);
    while (stack.length > 0) {
      const { row, col } = stack.pop() as LayoutCell;
      for (const [dr, dc] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const next = keyOf(row + dr, col + dc);
        if (left.has(next)) {
          left.delete(next);
          stack.push({ row: row + dr, col: col + dc, cx: 0, cy: 0 });
        }
      }
    }
  }
  return components;
}

function extremesOccupied(
  cells: LayoutCell[],
  rows: number,
  cols: number,
): boolean {
  let top = false;
  let bottom = false;
  let left = false;
  let right = false;
  for (const c of cells) {
    if (c.row === 0) top = true;
    if (c.row === rows - 1) bottom = true;
    if (c.col === 0) left = true;
    if (c.col === cols - 1) right = true;
  }
  return top && bottom && left && right;
}

/** Removes `excess` cells, most marginal first, without emptying an edge row/column or splitting the zone further. */
function trim(
  zone: ZoneShape,
  inside: LayoutCell[],
  rows: number,
  cols: number,
  excess: number,
): LayoutCell[] | null {
  const centreX = zone.box.x + zone.box.w / 2;
  const centreY = zone.box.y + zone.box.h / 2;
  const edgeDistance = new Map(
    inside.map((c) => [
      keyOf(c.row, c.col),
      distanceToPolygonEdge(c.cx, c.cy, zone.poly),
    ]),
  );
  const awayFromCentre = (c: LayoutCell) =>
    Math.hypot(c.cx - centreX, c.cy - centreY);

  let cells = inside.slice();
  const allowedComponents = componentCount(cells);
  for (let removed = 0; removed < excess; removed++) {
    const order = cells
      .slice()
      .sort(
        (a, b) =>
          (edgeDistance.get(keyOf(a.row, a.col)) as number) -
            (edgeDistance.get(keyOf(b.row, b.col)) as number) ||
          awayFromCentre(b) - awayFromCentre(a) ||
          b.row - a.row ||
          b.col - a.col,
      );
    let dropped = false;
    for (const candidate of order) {
      const rest = cells.filter((c) => c !== candidate);
      if (!extremesOccupied(rest, rows, cols)) continue;
      if (componentCount(rest) > allowedComponents) continue;
      cells = rest;
      dropped = true;
      break;
    }
    if (!dropped) return null;
  }
  return cells;
}

/** Candidate lattices (rows x cols) for a zone, best first: near-square cells, few cells to trim away. */
function candidateLattices(zone: ZoneShape, target: number) {
  const { box, poly } = zone;
  const ceiling = Math.max(target * 3 + 6, 12);
  const found: {
    rows: number;
    cols: number;
    inside: LayoutCell[];
    cost: number;
  }[] = [];

  for (let rows = 1; rows <= ceiling; rows++) {
    for (let cols = 1; rows * cols <= ceiling; cols++) {
      const cw = box.w / cols;
      const ch = box.h / rows;
      const skew = Math.abs(Math.log(cw / ch)); // 0 = square cells
      if (skew > 1.6) continue; // cells more than ~5:1 are never what we want
      const inside: LayoutCell[] = [];
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const cx = box.x + (col + 0.5) * cw;
          const cy = box.y + (row + 0.5) * ch;
          if (pointInPolygon(cx, cy, poly)) inside.push({ row, col, cx, cy });
        }
      }
      if (inside.length < target || !extremesOccupied(inside, rows, cols))
        continue;
      found.push({
        rows,
        cols,
        inside,
        cost: 2 * skew + (inside.length - target) / target,
      });
    }
  }
  return found.sort(
    (a, b) => a.cost - b.cost || a.rows - b.rows || a.cols - b.cols,
  );
}

/** The grid of one zone with exactly `target` cells. */
export function layoutZone(zone: ZoneShape, target: number): ZoneGrid {
  if (target < 1) throw new Error(`Zone ${zone.id} needs at least one cell`);
  for (const lattice of candidateLattices(zone, target).slice(0, 60)) {
    const cells =
      lattice.inside.length === target
        ? lattice.inside
        : trim(
            zone,
            lattice.inside,
            lattice.rows,
            lattice.cols,
            lattice.inside.length - target,
          );
    if (cells && cells.length === target) {
      cells.sort((a, b) => a.row - b.row || a.col - b.col);
      return {
        zoneId: zone.id,
        box: zone.box,
        rows: lattice.rows,
        cols: lattice.cols,
        cells,
      };
    }
  }
  throw new Error(`Could not lay out ${target} cells in zone ${zone.id}`);
}

/** Every zone's grid; the cell counts add up to exactly `total`. */
export function buildCampusGrid(
  zones: ZoneShape[],
  total: number = TOTAL_CELLS,
): CampusGrid {
  const counts = allocateCells(
    zones.map((z) => z.area),
    total,
  );
  const grids = zones.map((zone, i) => layoutZone(zone, counts[i]));
  const sum = grids.reduce((n, g) => n + g.cells.length, 0);
  if (sum !== total)
    throw new Error(`Layout has ${sum} cells, expected ${total}`);
  return { total, zones: grids };
}

/** Which (row, col) of a grid covers a point, or null outside it: the same arithmetic the map uses to pick a cell. */
export function cellAtPoint(
  grid: { box: Box; rows: number; cols: number },
  x: number,
  y: number,
): { row: number; col: number } | null {
  const col = Math.floor((x - grid.box.x) / (grid.box.w / grid.cols));
  const row = Math.floor((y - grid.box.y) / (grid.box.h / grid.rows));
  return row >= 0 && row < grid.rows && col >= 0 && col < grid.cols
    ? { row, col }
    : null;
}

/** Rectangle of one cell of a grid, in map units. */
export function cellRect(
  grid: { box: Box; rows: number; cols: number },
  row: number,
  col: number,
): Box {
  const w = grid.box.w / grid.cols;
  const h = grid.box.h / grid.rows;
  return { x: grid.box.x + col * w, y: grid.box.y + row * h, w, h };
}
