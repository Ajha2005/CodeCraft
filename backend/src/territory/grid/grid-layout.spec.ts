import * as fs from 'fs';
import * as path from 'path';
import {
  allocateCells,
  buildCampusGrid,
  cellAtPoint,
  cellRect,
} from './grid-layout';
import { TOTAL_CELLS } from './grid.config';
import { parseZones, pointInPolygon } from './svg-geometry';

const svg = fs.readFileSync(
  path.join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'frontend',
    'src',
    'assets',
    'campus-map.svg',
  ),
  'utf-8',
);
const zones = parseZones(svg);
const grid = buildCampusGrid(zones);

describe('allocateCells', () => {
  it('adds up to the total whatever the areas are', () => {
    const cases = [
      { areas: [1, 1, 1], total: 10 },
      { areas: [5, 3, 2], total: 1000 },
      { areas: [0.1, 99.9], total: 7 },
      { areas: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], total: 1000 },
      { areas: [3.3, 3.3, 3.3], total: 100 },
    ];
    for (const { areas, total } of cases) {
      expect(allocateCells(areas, total).reduce((a, b) => a + b, 0)).toBe(
        total,
      );
    }
  });

  it('keeps every zone within one cell of its exact share', () => {
    const areas = [10, 20, 30, 40, 13, 7];
    const total = 101;
    const sum = areas.reduce((a, b) => a + b, 0);
    allocateCells(areas, total).forEach((count, i) => {
      expect(Math.abs(count - (total * areas[i]) / sum)).toBeLessThan(1);
    });
  });

  it('never gives a zone fewer than the minimum, however small it is', () => {
    const counts = allocateCells([1000, 1, 0.001], 20);
    expect(counts.every((c) => c >= 1)).toBe(true);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(20);
  });

  it('gives ties to the earlier zone, so the answer is repeatable', () => {
    expect(allocateCells([1, 1, 1], 4)).toEqual([2, 1, 1]);
    expect(allocateCells([1, 1, 1], 4)).toEqual(allocateCells([1, 1, 1], 4));
  });

  it('refuses a total that cannot give every zone a cell', () => {
    expect(() => allocateCells([1, 1, 1], 2)).toThrow();
    expect(() => allocateCells([0, 0], 10)).toThrow();
  });
});

describe('the campus grid', () => {
  it('has exactly TOTAL_CELLS (1000) cells', () => {
    expect(TOTAL_CELLS).toBe(1000);
    expect(grid.total).toBe(1000);
    expect(grid.zones.reduce((n, z) => n + z.cells.length, 0)).toBe(1000);
  });

  it('covers every zone of the map', () => {
    expect(zones.length).toBe(46);
    expect(grid.zones.map((z) => z.zoneId)).toEqual(zones.map((z) => z.id));
    expect(grid.zones.every((z) => z.cells.length >= 1)).toBe(true);
  });

  it("splits the cells in proportion to the zones' areas", () => {
    const totalArea = zones.reduce((a, z) => a + z.area, 0);
    grid.zones.forEach((g, i) => {
      const exact = (TOTAL_CELLS * zones[i].area) / totalArea;
      expect(g.cells.length === 1 || Math.abs(g.cells.length - exact) < 1).toBe(
        true,
      );
    });
  });

  it('puts every cell inside its own zone, and in no other', () => {
    for (const g of grid.zones) {
      const own = zones.find((z) => z.id === g.zoneId)!;
      for (const cell of g.cells) {
        expect(pointInPolygon(cell.cx, cell.cy, own.poly)).toBe(true);
        const holders = zones
          .filter((z) => pointInPolygon(cell.cx, cell.cy, z.poly))
          .map((z) => z.id);
        expect(holders).toEqual([g.zoneId]);
      }
    }
  });

  it('never repeats a (zone, row, column) position', () => {
    const seen = new Set<string>();
    for (const g of grid.zones) {
      for (const c of g.cells) {
        const key = `${g.zoneId}:${c.row}:${c.col}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
    expect(seen.size).toBe(TOTAL_CELLS);
  });

  it('keeps the first and last row and column of every zone occupied, as the map expects', () => {
    // The map draws a zone as (highest row + 1) x (highest column + 1) rectangles over its bounding box.
    for (const g of grid.zones) {
      expect(Math.max(...g.cells.map((c) => c.row)) + 1).toBe(g.rows);
      expect(Math.max(...g.cells.map((c) => c.col)) + 1).toBe(g.cols);
      expect(Math.min(...g.cells.map((c) => c.row))).toBe(0);
      expect(Math.min(...g.cells.map((c) => c.col))).toBe(0);
    }
  });

  it('draws roughly square cells of roughly equal size across the whole map', () => {
    const totalArea = zones.reduce((a, z) => a + z.area, 0);
    const average = totalArea / TOTAL_CELLS;
    for (const g of grid.zones) {
      const own = zones.find((z) => z.id === g.zoneId)!;
      expect(
        Math.abs(Math.log(g.box.w / g.cols / (g.box.h / g.rows))),
      ).toBeLessThan(0.6);
      const perCell = own.area / g.cells.length;
      expect(perCell / average).toBeGreaterThan(0.8);
      expect(perCell / average).toBeLessThan(1.25);
    }
  });

  it('is the same every time it is built', () => {
    expect(buildCampusGrid(zones)).toEqual(grid);
  });

  it('can be built for other totals too', () => {
    for (const total of [46, 200, 554, 1500]) {
      expect(
        buildCampusGrid(zones, total).zones.reduce(
          (n, z) => n + z.cells.length,
          0,
        ),
      ).toBe(total);
    }
  });
});

describe('cellAtPoint (the arithmetic the map uses to pick a cell)', () => {
  it('finds every cell from the middle of its rectangle', () => {
    for (const g of grid.zones) {
      for (const c of g.cells) {
        const r = cellRect(g, c.row, c.col);
        expect(cellAtPoint(g, r.x + r.w / 2, r.y + r.h / 2)).toEqual({
          row: c.row,
          col: c.col,
        });
      }
    }
  });

  it('finds the cell from its corners too, taking the top-left edge as inside', () => {
    const g = grid.zones[0];
    const c = g.cells[0];
    const r = cellRect(g, c.row, c.col);
    expect(cellAtPoint(g, r.x, r.y)).toEqual({ row: c.row, col: c.col });
    expect(cellAtPoint(g, r.x + r.w - 1e-6, r.y + r.h - 1e-6)).toEqual({
      row: c.row,
      col: c.col,
    });
  });

  it("answers null outside the zone's box", () => {
    const g = grid.zones[0];
    expect(cellAtPoint(g, g.box.x - 1, g.box.y + 1)).toBeNull();
    expect(cellAtPoint(g, g.box.x + 1, g.box.y - 1)).toBeNull();
    expect(cellAtPoint(g, g.box.x + g.box.w + 1, g.box.y + 1)).toBeNull();
    expect(cellAtPoint(g, g.box.x + 1, g.box.y + g.box.h + 1)).toBeNull();
  });

  it('tiles the box: neighbouring rectangles meet without a gap or an overlap', () => {
    const g = grid.zones.find((z) => z.rows > 1 && z.cols > 1)!;
    const a = cellRect(g, 0, 0);
    const right = cellRect(g, 0, 1);
    const below = cellRect(g, 1, 0);
    expect(a.x + a.w).toBeCloseTo(right.x, 9);
    expect(a.y + a.h).toBeCloseTo(below.y, 9);
  });
});
