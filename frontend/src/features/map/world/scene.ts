import type { TerritoryDto } from '../../../types/territory';
import type { TerritoryCellDto } from '../../../lib/api';
import { aggregateOwnership, computeStripeWidths, type OwnerShare, type StripeSegment } from '../utils/computeStripeWidths';
import type { Campus, Zone } from './geometry';
import { FLAT_KINDS, TIER_STYLE } from './theme';

/** Oblique-projection vector: a unit of height shifts the roof by (-OBL_X, -1). */
export const OBL_X = 0.34;

export const cellKey = (row: number, col: number) => row * 4096 + col;

export interface FlashCell {
  row: number;
  col: number;
  /** Animation clock (seconds) at which the capture happened. */
  start: number;
}

/**
 * Everything the renderer needs to know about one zone *right now*. The
 * object is long-lived: data updates mutate it in place so animation state
 * (hover glow, capture flashes, ...) survives live ownership changes.
 */
export interface ZoneView {
  zone: Zone;
  path: Path2D;
  territory: TerritoryDto | null;
  cells: TerritoryCellDto[];
  cellIndex: Map<number, TerritoryCellDto>;
  /** Cell size in world units, stretched to tile the zone's bounding box. */
  cw: number;
  ch: number;
  shares: OwnerShare[];
  stripes: StripeSegment[];
  total: number;
  ownedCount: number;
  /** Fraction of the zone's cells that are captured (0..1). */
  fraction: number;
  contested: boolean;
  mineCount: number;
  topOwnerId: string | null;
  topColor: string | null;
  /** Height of the block above the ground, world units. Negative = sunken. */
  height: number;
  /** Smoothed 0..1 animation channels. */
  hover: number;
  select: number;
  /** Seconds-since-start of the last capture, or -1. */
  capturedAt: number;
  /** Whether per-cell detail is currently drawn (hysteresis lives here). */
  detail: boolean;
  discovered: boolean;
  /** cellId -> where/when the cell last changed hands (capture flash). */
  flashCells: Map<string, FlashCell>;
  /** Screen-independent label, fitted to the zone's width once fonts load. */
  label: string;
}

export function createZoneView(zone: Zone): ZoneView {
  const base = TIER_STYLE[zone.tier].height;
  const height = zone.kind === 'water' ? -3 : FLAT_KINDS.has(zone.kind) ? (zone.kind === 'forest' ? 3 : 1.5) : base;
  return {
    zone,
    path: new Path2D(zone.d),
    territory: null,
    cells: [],
    cellIndex: new Map(),
    cw: 0,
    ch: 0,
    shares: [],
    stripes: [],
    total: 0,
    ownedCount: 0,
    fraction: 0,
    contested: false,
    mineCount: 0,
    topOwnerId: null,
    topColor: null,
    height,
    hover: 0,
    select: 0,
    capturedAt: -1,
    detail: false,
    discovered: true,
    flashCells: new Map(),
    label: '',
  };
}

export interface SceneChange {
  /** Cells whose owner changed since the last update (never on first load). */
  captured: { view: ZoneView; cell: TerritoryCellDto; byMe: boolean }[];
}

/**
 * Re-derive every view from fresh territory/cell data. Returns which cells
 * changed hands so the engine can play capture effects for them.
 */
export function applySceneData(
  campus: Campus,
  views: ZoneView[],
  territories: Record<string, TerritoryDto>,
  cellsByTerritory: Record<string, TerritoryCellDto[]>,
  userId: string | null,
  now: number,
  isFirstLoad: boolean,
): SceneChange {
  const change: SceneChange = { captured: [] };

  for (const view of views) {
    const zone = campus.zones[view.zone.index];
    const territory = territories[zone.id] ?? null;
    const cells = territory ? (cellsByTerritory[territory.id] ?? []) : [];

    // Diff against the previous ownership so we can celebrate live captures.
    if (!isFirstLoad && view.cells.length > 0) {
      for (const cell of cells) {
        const prev = view.cellIndex.get(cellKey(cell.row, cell.col));
        if (prev && prev.ownerId !== cell.ownerId && cell.ownerId) {
          view.flashCells.set(cell.id, { row: cell.row, col: cell.col, start: now });
          change.captured.push({ view, cell, byMe: !!userId && cell.ownerId === userId });
        }
      }
    }

    view.territory = territory;
    view.cells = cells;
    view.cellIndex = new Map();
    let maxRow = 0;
    let maxCol = 0;
    let mine = 0;
    for (const c of cells) {
      view.cellIndex.set(cellKey(c.row, c.col), c);
      if (c.row > maxRow) maxRow = c.row;
      if (c.col > maxCol) maxCol = c.col;
      if (userId && c.ownerId === userId) mine++;
    }
    view.cw = cells.length ? zone.box.w / (maxCol + 1) : 0;
    view.ch = cells.length ? zone.box.h / (maxRow + 1) : 0;

    view.shares = aggregateOwnership(cells);
    view.stripes = view.shares.length > 1 ? computeStripeWidths(view.shares) : [];
    view.total = cells.length;
    view.ownedCount = view.shares.reduce((s, x) => s + x.cellCount, 0);
    view.fraction = view.total > 0 ? view.ownedCount / view.total : 0;
    view.contested = view.shares.length > 1;
    view.mineCount = mine;

    let top: OwnerShare | null = null;
    for (const s of view.shares) if (!top || s.cellCount > top.cellCount) top = s;
    view.topOwnerId = top?.userId ?? null;
    view.topColor = top?.color ?? null;
  }

  return change;
}

/** Roof translation for a zone: the roof floats `height` above its footprint. */
export function roofOffset(view: ZoneView): { dx: number; dy: number } {
  return { dx: -OBL_X * view.height, dy: -view.height };
}

/**
 * Which zone is under a world-space point, accounting for the roof being
 * drawn above (up-left of) the footprint. Walls count as part of the zone.
 * `order` must be the draw order (back to front); we scan front to back.
 */
export function pickZone(order: ZoneView[], wx: number, wy: number): ZoneView | null {
  for (let i = order.length - 1; i >= 0; i--) {
    const v = order[i];
    const h = Math.max(0, v.height);
    const b = v.zone.box;
    if (wx < b.x - OBL_X * h - 2 || wx > b.x + b.w + 2 || wy < b.y - h - 2 || wy > b.y + b.h + 2) continue;
    const steps = h > 4 ? 4 : 1;
    for (let s = steps; s >= 0; s--) {
      const t = s / steps; // 1 = roof, 0 = base
      if (pointInZone(v.zone, wx + OBL_X * h * t, wy + h * t)) return v;
    }
  }
  return null;
}

function pointInZone(zone: Zone, x: number, y: number): boolean {
  const poly = zone.poly;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i];
    const pj = poly[j];
    if (pi.y > y !== pj.y > y && x < ((pj.x - pi.x) * (y - pi.y)) / (pj.y - pi.y) + pi.x) inside = !inside;
  }
  return inside;
}

/** Cell under a world point inside a zone whose roof is currently drawn. */
export function pickCell(view: ZoneView, wx: number, wy: number): TerritoryCellDto | null {
  if (!view.cw || !view.ch) return null;
  const { dx, dy } = roofOffset(view);
  const x = wx - dx;
  const y = wy - dy;
  const b = view.zone.box;
  const col = Math.floor((x - b.x) / view.cw);
  const row = Math.floor((y - b.y) / view.ch);
  return view.cellIndex.get(cellKey(row, col)) ?? null;
}
