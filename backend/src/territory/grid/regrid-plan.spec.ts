import * as fs from 'fs';
import * as path from 'path';
import { legacyCells } from '../../../test/helpers/legacy-grid';
import { buildCampusGrid, cellAtPoint, cellRect } from './grid-layout';
import { OldCell, OpenDuel, OpenOwnership, planRegrid } from './regrid-plan';
import { Box, parseZones } from './svg-geometry';

// ---- tiny hand-made maps -------------------------------------------------

const BOX: Box = { x: 0, y: 0, w: 100, h: 100 };

/** A zone of rows x cols cells over BOX, as the layout makes them. */
function zoneGrid(zoneId: string, rows: number, cols: number) {
  const cells = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      cells.push({
        row,
        col,
        cx: BOX.x + ((col + 0.5) * BOX.w) / cols,
        cy: BOX.y + ((row + 0.5) * BOX.h) / rows,
      });
    }
  }
  return { zoneId, box: BOX, rows, cols, cells };
}

const oldCell = (
  id: string,
  row: number,
  col: number,
  zoneId = 'z',
): OldCell => ({ id, zoneId, row, col });
const own = (cellId: string, userId: string, day: number): OpenOwnership => ({
  cellId,
  userId,
  createdAt: new Date(Date.UTC(2026, 0, day)),
});
const counter = () => {
  let n = 0;
  return () => `new-${++n}`;
};
const cellAt = (
  plan: ReturnType<typeof planRegrid>,
  row: number,
  col: number,
  zoneId = 'z',
) =>
  plan.newCells.find(
    (c) => c.zoneId === zoneId && c.row === row && c.col === col,
  )!;
const ownerOfNew = (plan: ReturnType<typeof planRegrid>, cellId: string) =>
  plan.ownerships.find((o) => o.cellId === cellId);

describe('planRegrid on a small map', () => {
  // Old: 2x2 over the zone. New: 3x3. The new cell (0,0) sits in old (0,0); the four cells at the bottom right sit in old (1,1).
  const old = [
    oldCell('o00', 0, 0),
    oldCell('o01', 0, 1),
    oldCell('o10', 1, 0),
    oldCell('o11', 1, 1),
  ];
  const grid = { total: 9, zones: [zoneGrid('z', 3, 3)] };

  it('gives a new cell the owner of the old cell it sits in', () => {
    const plan = planRegrid({
      grid,
      oldCells: old,
      ownerships: [own('o00', 'alice', 1), own('o11', 'bob', 2)],
      duels: [],
      newId: counter(),
    });

    expect(plan.newCells).toHaveLength(9);
    expect(ownerOfNew(plan, cellAt(plan, 0, 0).id)?.userId).toBe('alice');
    for (const [row, col] of [
      [1, 1],
      [1, 2],
      [2, 1],
      [2, 2],
    ])
      expect(ownerOfNew(plan, cellAt(plan, row, col).id)?.userId).toBe('bob');
    for (const [row, col] of [
      [0, 1],
      [0, 2],
      [1, 0],
      [2, 0],
    ])
      expect(ownerOfNew(plan, cellAt(plan, row, col).id)).toBeUndefined();
    expect(plan.ownerships).toHaveLength(5);
    expect(plan.ownerships.every((o) => o.kind === 'overlap')).toBe(true);
    expect(plan.dropped).toEqual([]);
  });

  it("keeps the date each cell was captured, so nobody's holding time restarts", () => {
    const plan = planRegrid({
      grid,
      oldCells: old,
      ownerships: [own('o00', 'alice', 1), own('o11', 'bob', 2)],
      duels: [],
    });
    expect(
      plan.ownerships
        .filter((o) => o.userId === 'alice')
        .every((o) => o.createdAt.getTime() === Date.UTC(2026, 0, 1)),
    ).toBe(true);
    expect(
      plan.ownerships
        .filter((o) => o.userId === 'bob')
        .every((o) => o.createdAt.getTime() === Date.UTC(2026, 0, 2)),
    ).toBe(true);
    expect(plan.ownerships.map((o) => o.fromCellId).sort()).toEqual([
      'o00',
      'o11',
      'o11',
      'o11',
      'o11',
    ]);
  });

  it('hands out each new cell to at most one owner', () => {
    const plan = planRegrid({
      grid,
      oldCells: old,
      ownerships: old.map((c, i) => own(c.id, `user${i}`, i + 1)),
      duels: [],
    });
    const cells = plan.ownerships.map((o) => o.cellId);
    expect(new Set(cells).size).toBe(cells.length);
    expect(plan.ownerships).toHaveLength(9); // all four old cells were owned and together they cover the zone
  });

  it('moves an owned old cell that has no new centre inside it to the nearest free cell', () => {
    // Old 4x4, new 2x2: the new centres (25,25) (75,25) (25,75) (75,75) sit in old (1,1) (1,3) (3,1) (3,3), so old (0,0) is passed over.
    const fine = Array.from({ length: 16 }, (_, i) =>
      oldCell(`f${i}`, Math.floor(i / 4), i % 4),
    );
    const plan = planRegrid({
      grid: { total: 4, zones: [zoneGrid('z', 2, 2)] },
      oldCells: fine,
      ownerships: [own('f0', 'alice', 1), own('f5', 'bob', 2)],
      duels: [],
      newId: counter(),
    });
    expect(ownerOfNew(plan, cellAt(plan, 0, 0).id)).toMatchObject({
      userId: 'bob',
      kind: 'overlap',
    });
    expect(ownerOfNew(plan, cellAt(plan, 0, 1).id)).toMatchObject({
      userId: 'alice',
      kind: 'nearest',
      fromCellId: 'f0',
    });
    expect(plan.dropped).toEqual([]);
    expect(plan.zones[0]).toMatchObject({
      ownedOld: 2,
      inherited: 2,
      viaNearest: 1,
      dropped: 0,
    });
  });

  it("prefers a cell that was nobody's over one inside someone else's old cell", () => {
    // Old 1x4: Alice owns column 0, Bob columns 1. New 1x4 would cover them exactly; use 1x3 so a free cell exists in column 2/3 territory.
    const strip = [0, 1, 2, 3].map((c) => oldCell(`s${c}`, 0, c));
    const plan = planRegrid({
      grid: { total: 2, zones: [zoneGrid('z', 1, 2)] },
      oldCells: strip,
      ownerships: [own('s0', 'alice', 1), own('s1', 'bob', 2)],
      duels: [],
      newId: counter(),
    });
    // New centres: x=25 (old column 1: Bob) and x=75 (old column 3: nobody). Alice's column 0 has nothing in it.
    expect(ownerOfNew(plan, cellAt(plan, 0, 0).id)?.userId).toBe('bob');
    expect(ownerOfNew(plan, cellAt(plan, 0, 1).id)).toMatchObject({
      userId: 'alice',
      kind: 'nearest',
    });
  });

  it('drops the owners it has no room for, newest capture first, and says who', () => {
    const strip = [0, 1, 2, 3].map((c) => oldCell(`s${c}`, 0, c));
    const plan = planRegrid({
      grid: { total: 2, zones: [zoneGrid('z', 1, 2)] },
      oldCells: strip,
      // Bob (column 1) is covered; Alice (older) and Carol (newer) are not, and only one free cell is left.
      ownerships: [
        own('s0', 'alice', 1),
        own('s1', 'bob', 2),
        own('s2', 'carol', 3),
      ],
      duels: [],
      newId: counter(),
    });
    expect(ownerOfNew(plan, cellAt(plan, 0, 1).id)?.userId).toBe('alice');
    expect(plan.dropped).toEqual([
      { fromCellId: 's2', zoneId: 'z', userId: 'carol' },
    ]);
    expect(plan.zones[0].dropped).toBe(1);
  });

  it('lets the newest ownership win if a cell somehow has two open ones', () => {
    const plan = planRegrid({
      grid,
      oldCells: old,
      ownerships: [own('o00', 'older', 1), own('o00', 'newer', 5)],
      duels: [],
      newId: counter(),
    });
    expect(ownerOfNew(plan, cellAt(plan, 0, 0).id)?.userId).toBe('newer');
    expect(plan.ownerships).toHaveLength(1);
  });

  it('only creates cells when nothing is owned', () => {
    const plan = planRegrid({ grid, oldCells: old, ownerships: [], duels: [] });
    expect(plan.newCells).toHaveLength(9);
    expect(plan.ownerships).toEqual([]);
  });

  it('builds the whole map from nothing when there is no old grid', () => {
    const plan = planRegrid({ grid, oldCells: [], ownerships: [], duels: [] });
    expect(plan.newCells).toHaveLength(9);
    expect(plan.zones[0]).toMatchObject({
      oldCells: 0,
      newCells: 9,
      inherited: 0,
    });
  });

  it('refuses a cell whose zone has no outline any more', () => {
    expect(() =>
      planRegrid({
        grid,
        oldCells: [oldCell('x', 0, 0, 'gone')],
        ownerships: [],
        duels: [],
      }),
    ).toThrow(/no outline/);
  });

  it('is repeatable', () => {
    const run = () =>
      planRegrid({
        grid,
        oldCells: old,
        ownerships: [own('o00', 'alice', 1), own('o11', 'bob', 2)],
        duels: [],
        newId: counter(),
      });
    expect(run()).toEqual(run());
  });

  describe('duels', () => {
    const ownerships = [own('o00', 'alice', 1), own('o11', 'bob', 2)];

    it('follow the cells they were fought over', () => {
      const duels: OpenDuel[] = [
        { id: 'd1', cellId: 'o11', pledgedCellId: 'o00' },
      ];
      const plan = planRegrid({
        grid,
        oldCells: old,
        ownerships,
        duels,
        newId: counter(),
      });
      const [duel] = plan.duels;
      expect(duel.cancel).toBe(false);
      expect(ownerOfNew(plan, duel.cellId as string)?.userId).toBe('bob'); // the defender still holds the contested cell
      expect(ownerOfNew(plan, duel.pledgedCellId as string)?.userId).toBe(
        'alice',
      ); // the challenger still holds the stake
    });

    it('move to the new cell nearest the middle of the old one', () => {
      const plan = planRegrid({
        grid,
        oldCells: old,
        ownerships,
        duels: [{ id: 'd1', cellId: 'o11', pledgedCellId: null }],
        newId: counter(),
      });
      // The middle of old (1,1) is (75,75): the new cell centred at (83.3, 83.3), i.e. (2,2), is the nearest of Bob's four.
      expect(plan.duels[0].cellId).toBe(cellAt(plan, 2, 2).id);
    });

    it('keep having no stake if they never had one', () => {
      const plan = planRegrid({
        grid,
        oldCells: old,
        ownerships,
        duels: [{ id: 'd1', cellId: 'o11', pledgedCellId: null }],
      });
      expect(plan.duels[0]).toMatchObject({
        cancel: false,
        pledgedCellId: null,
      });
    });

    it('are cancelled when the contested cell cannot be carried over', () => {
      const plan = planRegrid({
        grid,
        oldCells: old,
        ownerships,
        duels: [{ id: 'd1', cellId: 'o01', pledgedCellId: 'o00' }],
      });
      expect(plan.duels[0]).toEqual({
        id: 'd1',
        cellId: null,
        pledgedCellId: null,
        cancel: true,
      });
    });

    it('are cancelled when the stake cannot be carried over', () => {
      const plan = planRegrid({
        grid,
        oldCells: old,
        ownerships,
        duels: [{ id: 'd1', cellId: 'o11', pledgedCellId: 'o10' }],
      });
      expect(plan.duels[0].cancel).toBe(true);
    });

    it('never share a new cell between two duels', () => {
      const plan = planRegrid({
        grid,
        oldCells: old,
        ownerships: [
          own('o00', 'alice', 1),
          own('o10', 'carol', 3),
          own('o11', 'bob', 2),
        ],
        duels: [
          { id: 'd1', cellId: 'o11', pledgedCellId: 'o00' },
          { id: 'd2', cellId: 'o10', pledgedCellId: null },
        ],
      });
      const used = plan.duels
        .flatMap((d) => [d.cellId, d.pledgedCellId])
        .filter((id): id is string => id !== null);
      expect(new Set(used).size).toBe(used.length);
    });
  });
});

// ---- the real campus -------------------------------------------------------

describe('planRegrid on the real campus map', () => {
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
  const legacy = legacyCells(svg);
  const oldCells: OldCell[] = legacy.map((c, i) => ({
    id: `old-${i}`,
    zoneId: c.zoneId,
    row: c.row,
    col: c.col,
  }));
  const zoneById = new Map(zones.map((z) => [z.id, z]));
  const oldById = new Map(oldCells.map((c) => [c.id, c]));

  /** The rectangle the map drew an old cell in. */
  const drawnRect = (cell: OldCell) => {
    const mine = oldCells.filter((c) => c.zoneId === cell.zoneId);
    const lattice = {
      box: (zoneById.get(cell.zoneId) as { box: Box }).box,
      rows: 1 + Math.max(...mine.map((c) => c.row)),
      cols: 1 + Math.max(...mine.map((c) => c.col)),
    };
    return { lattice, rect: cellRect(lattice, cell.row, cell.col) };
  };

  it('starts from the 554-cell grid the live map has', () => {
    expect(legacy).toHaveLength(554);
  });

  describe.each([
    [
      'every old cell owned by a different player',
      () => oldCells.map((c, i) => own(c.id, `user-${i}`, 1 + (i % 28))),
    ],
    [
      'a third of the old cells owned, by a handful of players',
      () =>
        oldCells
          .filter((_, i) => i % 3 === 0)
          .map((c, i) => own(c.id, `user-${i % 7}`, 1 + (i % 28))),
    ],
  ])('with %s', (_name, makeOwnerships) => {
    const ownerships = makeOwnerships();
    const plan = planRegrid({
      grid,
      oldCells,
      ownerships,
      duels: [],
      newId: counter(),
    });

    it('creates exactly 1000 cells', () => {
      expect(plan.newCells).toHaveLength(1000);
      expect(new Set(plan.newCells.map((c) => c.id)).size).toBe(1000);
    });

    it("loses nobody's territory", () => {
      expect(plan.dropped).toEqual([]);
      for (const o of ownerships) {
        expect(
          plan.ownerships.some(
            (p) => p.fromCellId === o.cellId && p.userId === o.userId,
          ),
        ).toBe(true);
      }
      const before = new Map<string, number>();
      for (const o of ownerships)
        before.set(o.userId, (before.get(o.userId) ?? 0) + 1);
      const after = new Map<string, number>();
      for (const p of plan.ownerships)
        after.set(p.userId, (after.get(p.userId) ?? 0) + 1);
      for (const [user, n] of before)
        expect(after.get(user) ?? 0).toBeGreaterThanOrEqual(n);
    });

    it('gives each new cell at most one owner, inside its own zone', () => {
      const cellIds = plan.ownerships.map((p) => p.cellId);
      expect(new Set(cellIds).size).toBe(cellIds.length);
      const zoneOfNew = new Map(plan.newCells.map((c) => [c.id, c.zoneId]));
      for (const p of plan.ownerships)
        expect(zoneOfNew.get(p.cellId)).toBe(
          (oldById.get(p.fromCellId) as OldCell).zoneId,
        );
    });

    it('only hands over a cell by overlap if its centre really is inside the old cell the owner held', () => {
      const centreOfNew = new Map<string, { cx: number; cy: number }>();
      for (const g of grid.zones) {
        const created = plan.newCells.filter((c) => c.zoneId === g.zoneId);
        g.cells.forEach((c, i) =>
          centreOfNew.set(created[i].id, { cx: c.cx, cy: c.cy }),
        );
      }
      for (const p of plan.ownerships.filter((q) => q.kind === 'overlap')) {
        const { lattice } = drawnRect(oldById.get(p.fromCellId) as OldCell);
        const centre = centreOfNew.get(p.cellId) as { cx: number; cy: number };
        const old = oldById.get(p.fromCellId) as OldCell;
        expect(cellAtPoint(lattice, centre.cx, centre.cy)).toEqual({
          row: old.row,
          col: old.col,
        });
      }
    });

    it('keeps the capture dates', () => {
      const dateOf = new Map(
        ownerships.map((o) => [o.cellId, o.createdAt.getTime()]),
      );
      for (const p of plan.ownerships)
        expect(p.createdAt.getTime()).toBe(dateOf.get(p.fromCellId));
    });

    it('accounts for every owned old cell in the per-zone summary', () => {
      expect(plan.zones.reduce((n, z) => n + z.ownedOld, 0)).toBe(
        ownerships.length,
      );
      expect(plan.zones.reduce((n, z) => n + z.newCells, 0)).toBe(1000);
      expect(plan.zones.reduce((n, z) => n + z.inherited, 0)).toBe(
        plan.ownerships.length,
      );
      expect(plan.zones.reduce((n, z) => n + z.dropped, 0)).toBe(0);
    });
  });

  it('has to move only a small share of owners to a neighbouring cell, even if every old cell is owned', () => {
    const plan = planRegrid({
      grid,
      oldCells,
      ownerships: oldCells.map((c, i) => own(c.id, `user-${i}`, 1)),
      duels: [],
    });
    const moved = plan.ownerships.filter((p) => p.kind === 'nearest').length;
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThan(oldCells.length * 0.12);
  });

  it('carries every open duel over when every cell is owned', () => {
    const owned = oldCells.map((c, i) => own(c.id, `user-${i}`, 1));
    const duels: OpenDuel[] = Array.from({ length: 40 }, (_, i) => ({
      id: `d${i}`,
      cellId: oldCells[i * 13].id,
      pledgedCellId: oldCells[i * 13 + 5].id,
    }));
    const plan = planRegrid({ grid, oldCells, ownerships: owned, duels });
    expect(plan.duels.every((d) => !d.cancel)).toBe(true);
    const used = plan.duels.flatMap((d) => [d.cellId, d.pledgedCellId]);
    expect(new Set(used).size).toBe(used.length);
    const byCell = new Map(plan.ownerships.map((p) => [p.cellId, p.userId]));
    duels.forEach((d, i) => {
      expect(byCell.get(plan.duels[i].cellId as string)).toBe(
        owned.find((o) => o.cellId === d.cellId)?.userId,
      );
      expect(byCell.get(plan.duels[i].pledgedCellId as string)).toBe(
        owned.find((o) => o.cellId === d.pledgedCellId)?.userId,
      );
    });
  });
});
