import { randomUUID } from 'crypto';
import { CampusGrid, cellAtPoint, cellRect } from './grid-layout';

/**
 * Works out what a regrid does to the people playing, without touching a
 * database: which new cell each owner ends up with and what happens to open
 * duels. prisma/regrid.ts feeds it rows and writes down what it returns.
 *
 * The rules:
 *  - A new cell whose centre lies inside an owned old cell inherits that owner.
 *  - An owned old cell never goes empty-handed: if no new centre fell inside it
 *    (new cells are laid out on a different lattice), its owner gets the nearest
 *    free new cell of the same zone instead.
 *  - Old cells are always compared as the map draws them: the zone's bounding box
 *    split into (highest row + 1) x (highest column + 1) rectangles.
 *  - A pending or active duel follows the cell it was about to be played for.
 *    One whose cell cannot be carried over is cancelled.
 */

/** A cell of the grid being replaced. `zoneId` is the zone's SVG path id. */
export interface OldCell {
  id: string;
  zoneId: string;
  row: number;
  col: number;
}

export interface OpenOwnership {
  cellId: string;
  userId: string;
  createdAt: Date;
}

export interface OpenDuel {
  id: string;
  cellId: string;
  pledgedCellId: string | null;
}

export interface RegridInput {
  grid: CampusGrid;
  oldCells: OldCell[];
  /** Ownerships that are still open, one per old cell. */
  ownerships: OpenOwnership[];
  duels: OpenDuel[];
  /** Id for each new cell; random UUIDs unless a test wants predictable ones. */
  newId?: () => string;
}

export interface PlannedCell {
  id: string;
  zoneId: string;
  row: number;
  col: number;
}

export interface PlannedOwnership {
  cellId: string;
  userId: string;
  /** When the old cell was captured: a regrid does not restart anyone's clock. */
  createdAt: Date;
  fromCellId: string;
  /** 'overlap' = the new cell's centre was inside the old cell, 'nearest' = nothing was, so it is the closest free cell. */
  kind: 'overlap' | 'nearest';
}

export interface DroppedOwnership {
  fromCellId: string;
  zoneId: string;
  userId: string;
}

export interface PlannedDuel {
  id: string;
  /** Where the duel is played from now on. Null when it is cancelled. */
  cellId: string | null;
  pledgedCellId: string | null;
  cancel: boolean;
}

export interface ZoneSummary {
  zoneId: string;
  oldCells: number;
  ownedOld: number;
  newCells: number;
  /** New cells that start out owned. */
  inherited: number;
  /** Owned old cells that had no new centre inside and were moved to the nearest free cell. */
  viaNearest: number;
  dropped: number;
}

export interface RegridPlan {
  newCells: PlannedCell[];
  ownerships: PlannedOwnership[];
  dropped: DroppedOwnership[];
  duels: PlannedDuel[];
  zones: ZoneSummary[];
}

const keyOf = (row: number, col: number) => `${row},${col}`;

interface Placed extends PlannedCell {
  cx: number;
  cy: number;
}

function nearest<T extends Placed>(
  candidates: T[],
  x: number,
  y: number,
): T | undefined {
  let best: T | undefined;
  let bestDistance = Infinity;
  for (const c of candidates) {
    const distance = Math.hypot(c.cx - x, c.cy - y);
    if (
      distance < bestDistance - 1e-9 ||
      (Math.abs(distance - bestDistance) <= 1e-9 &&
        best &&
        (c.row < best.row || (c.row === best.row && c.col < best.col)))
    ) {
      best = c;
      bestDistance = distance;
    }
  }
  return best;
}

export function planRegrid(input: RegridInput): RegridPlan {
  const newId = input.newId ?? randomUUID;
  const zoneIds = new Set(input.grid.zones.map((z) => z.zoneId));

  const oldByZone = new Map<string, OldCell[]>();
  for (const cell of input.oldCells) {
    if (!zoneIds.has(cell.zoneId))
      throw new Error(
        `Cell ${cell.id} sits in zone "${cell.zoneId}", which has no outline in the campus SVG`,
      );
    const list = oldByZone.get(cell.zoneId) ?? [];
    list.push(cell);
    oldByZone.set(cell.zoneId, list);
  }

  // One open ownership per cell is the rule; if the data ever says otherwise the newest wins.
  const ownerOf = new Map<string, OpenOwnership>();
  for (const o of input.ownerships) {
    const have = ownerOf.get(o.cellId);
    if (!have || o.createdAt > have.createdAt) ownerOf.set(o.cellId, o);
  }

  const newCells: PlannedCell[] = [];
  const ownerships: PlannedOwnership[] = [];
  const dropped: DroppedOwnership[] = [];
  const zones: ZoneSummary[] = [];
  const primary = new Map<string, string>(); // old cell id -> the new cell that carries it on

  for (const zone of input.grid.zones) {
    const cells: Placed[] = zone.cells.map((c) => ({
      id: newId(),
      zoneId: zone.zoneId,
      row: c.row,
      col: c.col,
      cx: c.cx,
      cy: c.cy,
    }));
    for (const c of cells)
      newCells.push({ id: c.id, zoneId: c.zoneId, row: c.row, col: c.col });

    const old = oldByZone.get(zone.zoneId) ?? [];
    const summary: ZoneSummary = {
      zoneId: zone.zoneId,
      oldCells: old.length,
      ownedOld: 0,
      newCells: cells.length,
      inherited: 0,
      viaNearest: 0,
      dropped: 0,
    };
    zones.push(summary);
    if (old.length === 0) continue;

    const lattice = {
      box: zone.box,
      rows: 1 + Math.max(...old.map((o) => o.row)),
      cols: 1 + Math.max(...old.map((o) => o.col)),
    };
    const oldAt = new Map(old.map((o) => [keyOf(o.row, o.col), o]));
    // Oldest capture first: if a zone ever runs out of room, the newest owners are the ones to lose out.
    const owned = old
      .filter((o) => ownerOf.has(o.id))
      .sort(
        (a, b) =>
          (ownerOf.get(a.id) as OpenOwnership).createdAt.getTime() -
            (ownerOf.get(b.id) as OpenOwnership).createdAt.getTime() ||
          a.id.localeCompare(b.id),
      );
    summary.ownedOld = owned.length;

    // Which owned old cell does each new cell sit in?
    const inside = new Map<string, Placed[]>();
    const insideOwned = new Set<string>();
    for (const n of cells) {
      const at = cellAtPoint(lattice, n.cx, n.cy);
      const o = at ? oldAt.get(keyOf(at.row, at.col)) : undefined;
      if (!o || !ownerOf.has(o.id)) continue;
      inside.set(o.id, [...(inside.get(o.id) ?? []), n]);
      insideOwned.add(n.id);
    }

    const claimed = new Set<string>();
    const claim = (n: Placed, o: OldCell, kind: PlannedOwnership['kind']) => {
      const ownership = ownerOf.get(o.id) as OpenOwnership;
      claimed.add(n.id);
      ownerships.push({
        cellId: n.id,
        userId: ownership.userId,
        createdAt: ownership.createdAt,
        fromCellId: o.id,
        kind,
      });
      summary.inherited += 1;
    };
    const middleOf = (o: OldCell) => {
      const r = cellRect(lattice, o.row, o.col);
      return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    };

    // 1. Every owned old cell with a new centre inside it keeps the one nearest its middle.
    for (const o of owned) {
      const mine = inside.get(o.id);
      if (!mine || mine.length === 0) continue;
      const m = middleOf(o);
      const first = nearest(mine, m.x, m.y) as Placed;
      claim(first, o, 'overlap');
      primary.set(o.id, first.id);
    }

    // 2. The rest move to the nearest free cell, preferring cells that were nobody's.
    for (const o of owned) {
      if (primary.has(o.id)) continue;
      const free = cells.filter((n) => !claimed.has(n.id));
      const nobodys = free.filter((n) => !insideOwned.has(n.id));
      const m = middleOf(o);
      const pick = nearest(nobodys.length > 0 ? nobodys : free, m.x, m.y);
      if (!pick) {
        dropped.push({
          fromCellId: o.id,
          zoneId: zone.zoneId,
          userId: (ownerOf.get(o.id) as OpenOwnership).userId,
        });
        summary.dropped += 1;
        continue;
      }
      claim(pick, o, 'nearest');
      primary.set(o.id, pick.id);
      summary.viaNearest += 1;
    }

    // 3. Whatever else lies inside an owned old cell goes to its owner too.
    for (const o of owned) {
      for (const n of inside.get(o.id) ?? [])
        if (!claimed.has(n.id)) claim(n, o, 'overlap');
    }
  }

  const duels: PlannedDuel[] = input.duels.map((d) => {
    const target = primary.get(d.cellId);
    const pledged =
      d.pledgedCellId === null ? null : primary.get(d.pledgedCellId);
    if (!target || pledged === undefined)
      return { id: d.id, cellId: null, pledgedCellId: null, cancel: true };
    return { id: d.id, cellId: target, pledgedCellId: pledged, cancel: false };
  });

  return { newCells, ownerships, dropped, duels, zones };
}
