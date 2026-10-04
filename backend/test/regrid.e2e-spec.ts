// The regrid against a real (scratch) Postgres. Needs TEST_DATABASE_URL and
// TEST_REDIS_URL pointing at throwaway local servers, see test/README.md. Skipped without them.
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '../generated/prisma/client';
import {
  TARGET_GRID_VERSION,
  TOTAL_CELLS,
} from '../src/territory/grid/grid.config';
import { buildCampusGrid } from '../src/territory/grid/grid-layout';
import { formatRegridReport, regrid } from '../src/territory/grid/regrid';
import { parseZones } from '../src/territory/grid/svg-geometry';
import { legacyCells } from './helpers/legacy-grid';
import {
  emptyDatabase,
  scratchPrisma,
  scratchUrls,
} from './helpers/scratch-db';

const urls = scratchUrls();
const svg = fs.readFileSync(
  path.join(
    __dirname,
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

const maybe = urls ? describe : describe.skip;

maybe('regrid on a scratch database', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = scratchPrisma((urls as { databaseUrl: string }).databaseUrl);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Territories, users, one problem and the old 554-cell grid, with most cells owned and a few duels open. */
  async function seedOldWorld(
    options: { cells?: boolean; skipZone?: string } = {},
  ) {
    await emptyDatabase(prisma);
    await prisma.territory.createMany({
      data: zones
        .filter((z) => z.id !== options.skipZone)
        .map((z) => ({ name: z.id, svgPathId: z.id, tier: 'OUTPOST' })),
    });
    const territories = await prisma.territory.findMany();
    const territoryId = new Map(territories.map((t) => [t.svgPathId, t.id]));

    await prisma.user.createMany({
      data: Array.from({ length: 8 }, (_, i) => ({
        email: `player${i}@thapar.edu`,
        username: `player${i}`,
      })),
    });
    const users = await prisma.user.findMany({ orderBy: { username: 'asc' } });
    const now = new Date();
    await prisma.problem.create({
      data: {
        id: 1,
        title: 'Two Sum',
        description: 'd',
        difficultyLevel: 'Easy',
        examples: [],
        constraints: [],
        testCases: [],
        createdAt: now,
        updatedAt: now,
      },
    });

    if (options.cells === false)
      return {
        users,
        territoryId,
        cells: [] as {
          id: string;
          territoryId: string;
          row: number;
          col: number;
        }[],
      };

    await prisma.territoryCell.createMany({
      data: legacyCells(svg).map((c) => ({
        territoryId: territoryId.get(c.zoneId) as string,
        row: c.row,
        col: c.col,
      })),
    });
    const cells = await prisma.territoryCell.findMany({
      orderBy: [{ territoryId: 'asc' }, { row: 'asc' }, { col: 'asc' }],
    });
    expect(cells).toHaveLength(554);

    // Four out of five cells are owned, by eight players, captured on different days.
    const owned = cells.filter((_, i) => i % 5 !== 0);
    await prisma.territoryCellOwnership.createMany({
      data: owned.map((c, i) => ({
        cellId: c.id,
        userId: users[i % 8].id,
        sourceType: i % 3 === 0 ? 'contest' : 'solve',
        createdAt: new Date(Date.UTC(2026, 0, 1 + (i % 28))),
      })),
    });
    // Some cells were captured twice: the earlier, closed ownership must be left alone.
    await prisma.territoryCellOwnership.createMany({
      data: owned.slice(0, 20).map((c, i) => ({
        cellId: c.id,
        userId: users[(i + 3) % 8].id,
        sourceType: 'solve',
        createdAt: new Date(Date.UTC(2025, 11, 1)),
        closedAt: new Date(Date.UTC(2025, 11, 20)),
      })),
    });
    return { users, territoryId, cells, owned };
  }

  /** Four duels: a pending one, an active one, a finished one, and one on a cell nobody owns. */
  async function seedDuels(world: Awaited<ReturnType<typeof seedOldWorld>>) {
    const { users, owned, cells } = world as {
      users: { id: string }[];
      owned: { id: string }[];
      cells: { id: string }[];
    };
    const ownerOf = async (cellId: string) =>
      (
        await prisma.territoryCellOwnership.findFirstOrThrow({
          where: { cellId, closedAt: null },
        })
      ).userId;
    const make = async (
      status: string,
      targetIndex: number,
      stakeIndex: number | null,
    ) => {
      const target = owned[targetIndex];
      const stake = stakeIndex === null ? null : owned[stakeIndex];
      return prisma.contest.create({
        data: {
          cellId: target.id,
          pledgedCellId: stake?.id ?? null,
          problemId: 1,
          challengerId: stake ? await ownerOf(stake.id) : users[0].id,
          defenderId: await ownerOf(target.id),
          status,
        },
      });
    };
    const pending = await make('PENDING', 10, 21);
    const active = await make('ACTIVE', 50, 61);
    const completed = await make('COMPLETED', 100, 111);
    const legacy = await make('PENDING', 150, null); // made before pledging existed
    const unowned = cells.find((c) => !owned.some((o) => o.id === c.id)) as {
      id: string;
    };
    const orphan = await prisma.contest.create({
      data: {
        cellId: unowned.id,
        problemId: 1,
        challengerId: users[0].id,
        defenderId: users[1].id,
        status: 'PENDING',
      },
    });
    return { pending, active, completed, legacy, orphan };
  }

  const snapshot = async () => ({
    cells: await prisma.territoryCell.count(),
    retired: await prisma.territoryCell.count({
      where: { retiredAt: { not: null } },
    }),
    version2: await prisma.territoryCell.count({
      where: { gridVersion: TARGET_GRID_VERSION },
    }),
    openOwnerships: await prisma.territoryCellOwnership.count({
      where: { closedAt: null },
    }),
    allOwnerships: await prisma.territoryCellOwnership.count(),
    contests: await prisma.contest.findMany({
      orderBy: { id: 'asc' },
      select: {
        id: true,
        status: true,
        cellId: true,
        pledgedCellId: true,
        endReason: true,
      },
    }),
    audit: await prisma.auditLog.count(),
  });

  describe('moving the 554-cell map to the 1000-cell map', () => {
    let world: Awaited<ReturnType<typeof seedOldWorld>>;
    let duels: Awaited<ReturnType<typeof seedDuels>>;
    let before: Awaited<ReturnType<typeof snapshot>>;
    let oldOwnerships: { cellId: string; userId: string; createdAt: Date }[];

    beforeAll(async () => {
      world = await seedOldWorld();
      duels = await seedDuels(world);
      before = await snapshot();
      oldOwnerships = await prisma.territoryCellOwnership.findMany({
        where: { closedAt: null },
        select: { cellId: true, userId: true, createdAt: true },
      });
    });

    it('a dry run reads the database and writes nothing', async () => {
      const report = await regrid(prisma, { svg, apply: false });
      expect(report.status).toBe('dry-run');
      expect(report.liveCellsBefore).toBe(554);
      expect(report.liveCellsAfter).toBe(TOTAL_CELLS);
      expect(report.ownedCellsBefore).toBe(oldOwnerships.length);
      expect(report.ownedCellsAfter).toBeGreaterThanOrEqual(
        oldOwnerships.length,
      );
      expect(report.droppedOwnerships).toBe(0);
      expect(report.ownersWithFewerCells).toBe(0);
      expect(report.duelsRemapped).toBe(3); // pending, active and the one without a stake; the finished duel is not open
      expect(report.duelsCancelled).toBe(1);
      expect(report.topOwners.length).toBeGreaterThan(0);
      expect(await snapshot()).toEqual(before);
      expect(formatRegridReport(report)).toContain(
        'Dry run: nothing was written',
      );
    });

    it('applies the change in one go', async () => {
      const report = await regrid(prisma, { svg, apply: true });
      expect(report.status).toBe('applied');
      expect(formatRegridReport(report)).toContain('Applied');
    });

    it('leaves exactly 1000 live cells, all on the new grid version, and deletes nothing', async () => {
      expect(
        await prisma.territoryCell.count({ where: { retiredAt: null } }),
      ).toBe(1000);
      expect(
        await prisma.territoryCell.count({
          where: { retiredAt: null, gridVersion: TARGET_GRID_VERSION },
        }),
      ).toBe(1000);
      expect(await prisma.territoryCell.count()).toBe(554 + 1000);
      expect(
        await prisma.territoryCell.count({
          where: { retiredAt: { not: null }, gridVersion: 1 },
        }),
      ).toBe(554);
    });

    it('gives every zone its own cells, one place each', async () => {
      const grid = buildCampusGrid(zones);
      const live = await prisma.territoryCell.findMany({
        where: { retiredAt: null },
        include: { territory: { select: { svgPathId: true } } },
      });
      for (const g of grid.zones) {
        const mine = live.filter((c) => c.territory.svgPathId === g.zoneId);
        expect(mine.map((c) => `${c.row},${c.col}`).sort()).toEqual(
          g.cells.map((c) => `${c.row},${c.col}`).sort(),
        );
      }
    });

    it('keeps the old ownership history and closes the old open ones', async () => {
      expect(
        await prisma.territoryCellOwnership.count({
          where: { cell: { retiredAt: { not: null } } },
        }),
      ).toBe(before.allOwnerships);
      expect(
        await prisma.territoryCellOwnership.count({
          where: { closedAt: null, cell: { retiredAt: { not: null } } },
        }),
      ).toBe(0);
    });

    it('opens ownerships on the new cells with sourceType "regrid" and the original capture dates', async () => {
      const open = await prisma.territoryCellOwnership.findMany({
        where: { closedAt: null },
        include: { cell: true },
      });
      expect(open.length).toBeGreaterThanOrEqual(oldOwnerships.length);
      expect(
        open.every(
          (o) =>
            o.sourceType === 'regrid' &&
            o.cell.retiredAt === null &&
            o.cell.gridVersion === TARGET_GRID_VERSION,
        ),
      ).toBe(true);
      const dates = new Set(oldOwnerships.map((o) => o.createdAt.getTime()));
      expect(open.every((o) => dates.has(o.createdAt.getTime()))).toBe(true);
    });

    it('does not lose a single player any territory', async () => {
      const count = (rows: { userId: string }[]) => {
        const m = new Map<string, number>();
        for (const r of rows) m.set(r.userId, (m.get(r.userId) ?? 0) + 1);
        return m;
      };
      const was = count(oldOwnerships);
      const is = count(
        await prisma.territoryCellOwnership.findMany({
          where: { closedAt: null },
          select: { userId: true },
        }),
      );
      for (const [user, n] of was)
        expect(is.get(user) ?? 0).toBeGreaterThanOrEqual(n);
    });

    it('moves open duels to the new cells, keeping the defender and the challenger on their own cells', async () => {
      for (const duel of [duels.pending, duels.active, duels.legacy]) {
        const now = await prisma.contest.findUniqueOrThrow({
          where: { id: duel.id },
          include: { cell: true, pledgedCell: true },
        });
        expect(now.status).toBe(duel.status);
        expect(now.cell.retiredAt).toBeNull();
        expect(now.cell.gridVersion).toBe(TARGET_GRID_VERSION);
        const holder = await prisma.territoryCellOwnership.findFirstOrThrow({
          where: { cellId: now.cellId, closedAt: null },
        });
        expect(holder.userId).toBe(duel.defenderId);
        if (duel.pledgedCellId) {
          expect(now.pledgedCell?.retiredAt).toBeNull();
          const staked = await prisma.territoryCellOwnership.findFirstOrThrow({
            where: { cellId: now.pledgedCellId as string, closedAt: null },
          });
          expect(staked.userId).toBe(duel.challengerId);
        } else {
          expect(now.pledgedCellId).toBeNull();
        }
      }
    });

    it('cancels the duel it cannot carry over, and leaves finished duels alone', async () => {
      const orphan = await prisma.contest.findUniqueOrThrow({
        where: { id: duels.orphan.id },
      });
      expect(orphan).toMatchObject({
        status: 'CANCELLED',
        endReason: 'REGRID',
      });
      expect(orphan.endedAt).not.toBeNull();
      const completed = await prisma.contest.findUniqueOrThrow({
        where: { id: duels.completed.id },
      });
      expect(completed).toMatchObject({
        status: 'COMPLETED',
        cellId: duels.completed.cellId,
        pledgedCellId: duels.completed.pledgedCellId,
      });
    });

    it('records one audit row', async () => {
      const rows = await prisma.auditLog.findMany({
        where: { action: 'territory.regrid' },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actorType: 'SYSTEM',
        targetType: 'grid',
        targetId: `v${TARGET_GRID_VERSION}`,
      });
      expect(rows[0].metadata).toMatchObject({
        newCells: 1000,
        retiredCells: 554,
        droppedOwnerships: 0,
        duelsRemapped: 3,
        duelsCancelled: 1,
      });
    });

    it('does nothing the second time', async () => {
      const after = await snapshot();
      const dry = await regrid(prisma, { svg, apply: false });
      const again = await regrid(prisma, { svg, apply: true });
      expect(dry.status).toBe('already-current');
      expect(again.status).toBe('already-current');
      expect(formatRegridReport(again)).toContain('Nothing to do');
      expect(await snapshot()).toEqual(after);
    });
  });

  describe('when something goes wrong', () => {
    it('rolls everything back if a write fails halfway', async () => {
      const world = await seedOldWorld();
      await seedDuels(world);
      // A retired cell already sitting where a new one is to go: the insert hits the unique key after nothing else is written.
      const first = buildCampusGrid(zones).zones[0];
      await prisma.territoryCell.create({
        data: {
          territoryId: world.territoryId.get(first.zoneId) as string,
          row: first.cells[0].row,
          col: first.cells[0].col,
          gridVersion: TARGET_GRID_VERSION,
          retiredAt: new Date(),
        },
      });
      const before = await snapshot();
      await expect(regrid(prisma, { svg, apply: true })).rejects.toThrow();
      expect(await snapshot()).toEqual(before);
    });

    it('refuses a plan that reuses a cell id before it writes anything', async () => {
      await seedOldWorld();
      const before = await snapshot();
      await expect(
        regrid(prisma, { svg, apply: true, newId: () => 'same-id' }),
      ).rejects.toThrow(/reuses a cell id/);
      expect(await snapshot()).toEqual(before);
    });

    it('refuses a map that mixes old and new live cells', async () => {
      const world = await seedOldWorld();
      const first = buildCampusGrid(zones).zones[0];
      await prisma.territoryCell.create({
        data: {
          territoryId: world.territoryId.get(first.zoneId) as string,
          row: first.cells[0].row,
          col: first.cells[0].col,
          gridVersion: TARGET_GRID_VERSION,
        },
      });
      const before = await snapshot();
      await expect(regrid(prisma, { svg, apply: true })).rejects.toThrow(
        /mixes grid versions/,
      );
      expect(await snapshot()).toEqual(before);
    });

    it('refuses to run when a map zone has no territory row, and names it', async () => {
      await seedOldWorld({ cells: false, skipZone: 'library' });
      const before = await snapshot();
      await expect(regrid(prisma, { svg, apply: true })).rejects.toThrow(
        /library/,
      );
      await expect(regrid(prisma, { svg, apply: false })).rejects.toThrow(
        /territories table/,
      );
      expect(await snapshot()).toEqual(before);
    });
  });

  describe('on a database with territories but no cells yet', () => {
    it('builds the 1000-cell map from scratch', async () => {
      await seedOldWorld({ cells: false });
      const report = await regrid(prisma, { svg, apply: true });
      expect(report.status).toBe('applied');
      expect(report.liveCellsBefore).toBe(0);
      expect(
        await prisma.territoryCell.count({
          where: { retiredAt: null, gridVersion: TARGET_GRID_VERSION },
        }),
      ).toBe(1000);
      expect(await prisma.territoryCellOwnership.count()).toBe(0);
      expect((await regrid(prisma, { svg, apply: true })).status).toBe(
        'already-current',
      );
    });
  });

  it('only ever sees the old 554 cells in the helper that builds the "before" state', () => {
    expect(legacyCells(svg)).toHaveLength(554);
  });
});
