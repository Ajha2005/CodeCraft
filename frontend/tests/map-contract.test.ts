// The server decides where the 1000 cells are; the browser draws them and works out
// which one the pointer is over. This test runs the real layout from the backend
// through the real renderer logic in this app, over the real campus map, and checks
// that the two agree on every cell. (It lives outside src/ because it imports backend
// code, which the app's own type-check should not pull in.)
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { buildCampusGrid, cellRect, type CampusGrid } from '../../backend/src/territory/grid/grid-layout';
import { parseZones } from '../../backend/src/territory/grid/svg-geometry';
import type { TerritoryCellDto } from '../src/lib/api';
import { UNCLAIMED_COLOR } from '../src/lib/playerColor';
import type { Campus, Zone } from '../src/features/map/world/geometry';
import { applySceneData, cellKey, createZoneView, pickCell, roofOffset, type ZoneView } from '../src/features/map/world/scene';
import type { TerritoryDto } from '../src/types/territory';

vi.stubGlobal('Path2D', class {});

const svg = readFileSync(new URL('../src/assets/campus-map.svg', import.meta.url), 'utf8');
const shapes = parseZones(svg);
const grid: CampusGrid = buildCampusGrid(shapes);

const zones: Zone[] = shapes.map((s, index) => ({
  id: s.id,
  index,
  tier: 'OUTPOST',
  kind: 'academic',
  d: '',
  poly: s.poly,
  box: s.box,
  anchor: { x: s.box.x + s.box.w / 2, y: s.box.y + s.box.h / 2 },
  labelWidth: 0,
  area: s.area,
  seed: 0,
}));
const campus: Campus = { width: 3018, height: 1597, zones, byId: new Map(zones.map((z) => [z.id, z])) };

const territories: Record<string, TerritoryDto> = Object.fromEntries(zones.map((z) => [z.id, { id: `t-${z.id}`, name: z.id, svgPathId: z.id, tier: 'OUTPOST' }]));

function cellsOf(owner: (zoneId: string, row: number, col: number) => { name: string; me: boolean } | null): Record<string, TerritoryCellDto[]> {
  const out: Record<string, TerritoryCellDto[]> = {};
  for (const g of grid.zones) {
    out[`t-${g.zoneId}`] = g.cells.map((c) => {
      const who = owner(g.zoneId, c.row, c.col);
      return {
        id: `${g.zoneId}:${c.row}:${c.col}`,
        territoryId: `t-${g.zoneId}`,
        row: c.row,
        col: c.col,
        ownerId: who?.name ?? null,
        ownerUsername: who?.name ?? null,
        ownerColor: who ? '#ef4444' : UNCLAIMED_COLOR,
        isMe: !!who?.me,
      };
    });
  }
  return out;
}

describe('the 1000-cell layout and the map\'s hit-testing', () => {
  let views: ZoneView[];

  beforeAll(() => {
    views = zones.map(createZoneView);
    applySceneData(campus, views, territories, cellsOf(() => null), 0, true);
  });

  it('has exactly 1000 cells in the map\'s views', () => {
    expect(views.reduce((n, v) => n + v.cells.length, 0)).toBe(1000);
  });

  it('draws each zone\'s cells so that they tile its bounding box', () => {
    for (const v of views) {
      const g = grid.zones.find((z) => z.zoneId === v.zone.id) as CampusGrid['zones'][number];
      expect(v.cw).toBeCloseTo(v.zone.box.w / g.cols, 9);
      expect(v.ch).toBeCloseTo(v.zone.box.h / g.rows, 9);
    }
  });

  it('finds every one of the 1000 cells from a point in the middle of it', () => {
    for (const v of views) {
      const g = grid.zones.find((z) => z.zoneId === v.zone.id) as CampusGrid['zones'][number];
      const { dx, dy } = roofOffset(v); // the roof is drawn above the footprint
      for (const c of g.cells) {
        const r = cellRect(g, c.row, c.col);
        const picked = pickCell(v, r.x + r.w / 2 + dx, r.y + r.h / 2 + dy);
        expect([v.zone.id, c.row, c.col, picked?.id]).toEqual([v.zone.id, c.row, c.col, `${v.zone.id}:${c.row}:${c.col}`]);
      }
    }
  });

  it('finds a cell from near each of its four corners too', () => {
    for (const v of views.slice(0, 12)) {
      const g = grid.zones.find((z) => z.zoneId === v.zone.id) as CampusGrid['zones'][number];
      const { dx, dy } = roofOffset(v);
      for (const c of g.cells) {
        const r = cellRect(g, c.row, c.col);
        for (const [fx, fy] of [[0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]]) {
          expect(pickCell(v, r.x + r.w * fx + dx, r.y + r.h * fy + dy)?.id).toBe(`${v.zone.id}:${c.row}:${c.col}`);
        }
      }
    }
  });

  it('finds nothing where the layout left a gap, or outside the zone\'s box', () => {
    for (const v of views) {
      const g = grid.zones.find((z) => z.zoneId === v.zone.id) as CampusGrid['zones'][number];
      const { dx, dy } = roofOffset(v);
      const have = new Set(g.cells.map((c) => cellKey(c.row, c.col)));
      for (let row = 0; row < g.rows; row++) {
        for (let col = 0; col < g.cols; col++) {
          if (have.has(cellKey(row, col))) continue;
          const r = cellRect(g, row, col);
          expect(pickCell(v, r.x + r.w / 2 + dx, r.y + r.h / 2 + dy)).toBeNull();
        }
      }
      expect(pickCell(v, v.zone.box.x - 5 + dx, v.zone.box.y - 5 + dy)).toBeNull();
      expect(pickCell(v, v.zone.box.x + v.zone.box.w + 5 + dx, v.zone.box.y + v.zone.box.h + 5 + dy)).toBeNull();
    }
  });
});

describe('who holds what, as the map reads it', () => {
  it('counts a player\'s cells from the server\'s isMe, and says whose zone it is', () => {
    const views = zones.map(createZoneView);
    const first = grid.zones[0];
    const second = grid.zones[1];
    const owned = cellsOf((zoneId, row) => {
      if (zoneId === first.zoneId) return { name: 'alice', me: true };
      if (zoneId === second.zoneId) return row === 0 ? { name: 'alice', me: true } : { name: 'bob', me: false };
      return null;
    });

    applySceneData(campus, views, territories, owned, 0, true);

    const mine = views.find((v) => v.zone.id === first.zoneId) as ZoneView;
    expect(mine.mineCount).toBe(first.cells.length);
    expect(mine.topOwnerIsMe).toBe(true);
    expect(mine.blobs.every((b) => b.isMe)).toBe(true);

    const shared = views.find((v) => v.zone.id === second.zoneId) as ZoneView;
    expect(shared.mineCount).toBe(second.cells.filter((c) => c.row === 0).length);
    expect(shared.contested).toBe(true);

    const other = views.find((v) => v.zone.id === grid.zones[2].zoneId) as ZoneView;
    expect(other.mineCount).toBe(0);
    expect(other.topOwnerIsMe).toBe(false);
  });

  it('never treats anything as mine when the server says nothing is (a demo guest)', () => {
    const views = zones.map(createZoneView);
    applySceneData(campus, views, territories, cellsOf(() => ({ name: 'alice', me: false })), 0, true);
    expect(views.some((v) => v.mineCount > 0 || v.topOwnerIsMe)).toBe(false);
    expect(views.flatMap((v) => v.blobs).some((b) => b.isMe)).toBe(false);
  });

  it('reports a capture as mine only when the server marked the new owner as me', () => {
    const views = zones.map(createZoneView);
    applySceneData(campus, views, territories, cellsOf(() => null), 0, true);

    const target = grid.zones[0].cells[0];
    const claim = (me: boolean) =>
      cellsOf((zoneId, row, col) => (zoneId === grid.zones[0].zoneId && row === target.row && col === target.col ? { name: 'alice', me } : null));

    const theirs = applySceneData(campus, views, territories, claim(false), 1, false);
    expect(theirs.captured.map((c) => c.byMe)).toEqual([false]);

    const views2 = zones.map(createZoneView);
    applySceneData(campus, views2, territories, cellsOf(() => null), 0, true);
    const mine = applySceneData(campus, views2, territories, claim(true), 1, false);
    expect(mine.captured.map((c) => c.byMe)).toEqual([true]);
  });
});
