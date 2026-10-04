import { Prisma, PrismaClient } from '../../../generated/prisma/client';
import { TARGET_GRID_VERSION, TOTAL_CELLS } from './grid.config';
import { buildCampusGrid } from './grid-layout';
import { RegridPlan, ZoneSummary, planRegrid } from './regrid-plan';
import { parseZones } from './svg-geometry';

/**
 * Moves the live map from its current grid to the TOTAL_CELLS grid, in one
 * transaction, without deleting a single row:
 *   - the new cells are inserted (gridVersion = TARGET_GRID_VERSION),
 *   - old cells get `retiredAt` and every query that shows the map ignores them,
 *   - open ownerships on old cells are closed and new ones (sourceType 'regrid')
 *     are opened on the cells that inherit them (see regrid-plan.ts),
 *   - pending and active duels move to the new cells, or are cancelled,
 *   - an audit_logs row records what happened.
 *
 * It is safe to run twice: once the live grid is already the target version it
 * changes nothing. Without `apply` it only reads the database and reports.
 */

export interface RegridOptions {
  /** Contents of frontend/src/assets/campus-map.svg. */
  svg: string;
  /** Write the change. Without it the run is a dry run. */
  apply: boolean;
  now?: Date;
  /** Predictable ids for tests. */
  newId?: () => string;
}

export interface OwnerMovement {
  username: string;
  before: number;
  after: number;
}

export interface RegridReport {
  /** 'already-current': nothing to do. 'dry-run': plan only. 'applied': the database was changed. */
  status: 'already-current' | 'dry-run' | 'applied';
  gridVersion: number;
  liveCellsBefore: number;
  liveCellsAfter: number;
  retiredCells: number;
  ownedCellsBefore: number;
  ownedCellsAfter: number;
  owners: number;
  ownersWithFewerCells: number;
  droppedOwnerships: number;
  duelsRemapped: number;
  duelsCancelled: number;
  zones: ZoneSummary[];
  topOwners: OwnerMovement[];
}

const OPEN_DUEL_STATUSES = ['PENDING', 'ACTIVE'];

export async function regrid(
  prisma: PrismaClient,
  options: RegridOptions,
): Promise<RegridReport> {
  const zones = parseZones(options.svg);
  if (zones.length === 0) throw new Error('No zones found in the campus SVG');
  const grid = buildCampusGrid(zones); // throws unless the cells add up to exactly TOTAL_CELLS

  if (!options.apply) return execute(prisma, options, grid, false);
  return prisma.$transaction((tx) => execute(tx, options, grid, true), {
    timeout: 120_000,
    maxWait: 15_000,
  });
}

async function execute(
  db: Prisma.TransactionClient,
  options: RegridOptions,
  grid: ReturnType<typeof buildCampusGrid>,
  apply: boolean,
): Promise<RegridReport> {
  const now = options.now ?? new Date();

  if (apply) {
    // Writers wait for us instead of racing us, and we give up rather than wait for ever.
    await db.$executeRaw`SET LOCAL lock_timeout = '15s'`;
    await db.$executeRaw`LOCK TABLE territory_cells, territory_cell_ownerships, contests IN SHARE ROW EXCLUSIVE MODE`;
  }

  const territories = await db.territory.findMany({
    select: { id: true, svgPathId: true },
  });
  const territoryBySvgId = new Map(territories.map((t) => [t.svgPathId, t.id]));
  const svgIdByTerritory = new Map(territories.map((t) => [t.id, t.svgPathId]));
  const missing = grid.zones
    .map((z) => z.zoneId)
    .filter((id) => !territoryBySvgId.has(id));
  if (missing.length > 0) {
    throw new Error(
      `These map zones have no row in the territories table, run the seed first: ${missing.join(', ')}`,
    );
  }

  const live = await db.territoryCell.findMany({
    where: { retiredAt: null },
    select: {
      id: true,
      territoryId: true,
      row: true,
      col: true,
      gridVersion: true,
    },
  });
  const current = live.filter((c) => c.gridVersion >= TARGET_GRID_VERSION);
  const previous = live.filter((c) => c.gridVersion < TARGET_GRID_VERSION);
  if (current.length > 0 && previous.length > 0) {
    throw new Error(
      `The live map mixes grid versions (${previous.length} old and ${current.length} new cells). Not touching it, look at it by hand first.`,
    );
  }

  const empty = (status: RegridReport['status']): RegridReport => ({
    status,
    gridVersion: TARGET_GRID_VERSION,
    liveCellsBefore: live.length,
    liveCellsAfter: live.length,
    retiredCells: 0,
    ownedCellsBefore: 0,
    ownedCellsAfter: 0,
    owners: 0,
    ownersWithFewerCells: 0,
    droppedOwnerships: 0,
    duelsRemapped: 0,
    duelsCancelled: 0,
    zones: [],
    topOwners: [],
  });
  if (current.length > 0) return empty('already-current');

  const ownerships = await db.territoryCellOwnership.findMany({
    where: { closedAt: null, cell: { retiredAt: null } },
    select: { cellId: true, userId: true, createdAt: true },
  });
  const duels = await db.contest.findMany({
    where: { status: { in: OPEN_DUEL_STATUSES } },
    select: { id: true, cellId: true, pledgedCellId: true },
  });

  const plan = planRegrid({
    grid,
    oldCells: previous.map((c) => ({
      id: c.id,
      zoneId:
        svgIdByTerritory.get(c.territoryId) ??
        `unknown-territory:${c.territoryId}`,
      row: c.row,
      col: c.col,
    })),
    ownerships,
    duels,
    newId: options.newId,
  });
  assertPlan(plan);

  const report = await summarise(
    db,
    plan,
    ownerships,
    previous.length,
    apply ? 'applied' : 'dry-run',
  );
  if (!apply) return report;

  const oldIds = previous.map((c) => c.id);
  await db.territoryCell.createMany({
    data: plan.newCells.map((c) => ({
      id: c.id,
      territoryId: territoryBySvgId.get(c.zoneId) as string,
      row: c.row,
      col: c.col,
      gridVersion: TARGET_GRID_VERSION,
    })),
  });
  await db.territoryCellOwnership.updateMany({
    where: { closedAt: null, cellId: { in: oldIds } },
    data: { closedAt: now },
  });
  await db.territoryCell.updateMany({
    where: { id: { in: oldIds } },
    data: { retiredAt: now },
  });
  await db.territoryCellOwnership.createMany({
    data: plan.ownerships.map((o) => ({
      cellId: o.cellId,
      userId: o.userId,
      sourceType: 'regrid',
      createdAt: o.createdAt,
    })),
  });
  for (const duel of plan.duels) {
    if (duel.cancel) {
      await db.contest.update({
        where: { id: duel.id },
        data: { status: 'CANCELLED', endReason: 'REGRID', endedAt: now },
      });
    } else {
      await db.contest.update({
        where: { id: duel.id },
        data: {
          cellId: duel.cellId as string,
          pledgedCellId: duel.pledgedCellId,
        },
      });
    }
  }
  await db.auditLog.create({
    data: {
      actorType: 'SYSTEM',
      action: 'territory.regrid',
      targetType: 'grid',
      targetId: `v${TARGET_GRID_VERSION}`,
      reason: `Map regrid: ${previous.length} -> ${TOTAL_CELLS} cells`,
      metadata: {
        retiredCells: report.retiredCells,
        newCells: plan.newCells.length,
        inheritedCells: report.ownedCellsAfter,
        ownedCellsBefore: report.ownedCellsBefore,
        owners: report.owners,
        droppedOwnerships: report.droppedOwnerships,
        duelsRemapped: report.duelsRemapped,
        duelsCancelled: report.duelsCancelled,
      },
    },
  });

  await verifyApplied(db, plan);
  return report;
}

/** Things that would mean a bug in the planner. Checked before anything is written. */
function assertPlan(plan: RegridPlan): void {
  if (plan.newCells.length !== TOTAL_CELLS)
    throw new Error(
      `The plan has ${plan.newCells.length} cells, expected ${TOTAL_CELLS}`,
    );
  const ids = new Set(plan.newCells.map((c) => c.id));
  if (ids.size !== plan.newCells.length)
    throw new Error('The plan reuses a cell id');
  const seen = new Set<string>();
  for (const o of plan.ownerships) {
    if (!ids.has(o.cellId))
      throw new Error('An ownership points at a cell the plan does not create');
    if (seen.has(o.cellId)) throw new Error('A new cell would get two owners');
    seen.add(o.cellId);
  }
  for (const d of plan.duels) {
    if (!d.cancel && (!d.cellId || !ids.has(d.cellId)))
      throw new Error('A duel would point at a cell the plan does not create');
  }
}

async function summarise(
  db: Prisma.TransactionClient,
  plan: RegridPlan,
  before: { cellId: string; userId: string }[],
  oldCellCount: number,
  status: RegridReport['status'],
): Promise<RegridReport> {
  const countBefore = new Map<string, number>();
  for (const o of before)
    countBefore.set(o.userId, (countBefore.get(o.userId) ?? 0) + 1);
  const countAfter = new Map<string, number>();
  for (const o of plan.ownerships)
    countAfter.set(o.userId, (countAfter.get(o.userId) ?? 0) + 1);

  let fewer = 0;
  for (const [userId, n] of countBefore)
    if ((countAfter.get(userId) ?? 0) < n) fewer += 1;

  const top = [...countAfter.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10);
  const users =
    top.length > 0
      ? await db.user.findMany({
          where: { id: { in: top.map(([id]) => id) } },
          select: { id: true, username: true },
        })
      : [];
  const nameOf = new Map(users.map((u) => [u.id, u.username]));

  return {
    status,
    gridVersion: TARGET_GRID_VERSION,
    liveCellsBefore: oldCellCount,
    liveCellsAfter: plan.newCells.length,
    retiredCells: oldCellCount,
    ownedCellsBefore: before.length,
    ownedCellsAfter: plan.ownerships.length,
    owners: countBefore.size,
    ownersWithFewerCells: fewer,
    droppedOwnerships: plan.dropped.length,
    duelsRemapped: plan.duels.filter((d) => !d.cancel).length,
    duelsCancelled: plan.duels.filter((d) => d.cancel).length,
    zones: plan.zones,
    topOwners: top.map(([id, after]) => ({
      username: nameOf.get(id) ?? '(unknown)',
      before: countBefore.get(id) ?? 0,
      after,
    })),
  };
}

/** Run inside the transaction: if the database does not look the way the plan says, the whole regrid rolls back. */
async function verifyApplied(
  db: Prisma.TransactionClient,
  plan: RegridPlan,
): Promise<void> {
  const liveCells = await db.territoryCell.count({
    where: { retiredAt: null },
  });
  if (liveCells !== TOTAL_CELLS)
    throw new Error(
      `After the regrid ${liveCells} cells are live, expected ${TOTAL_CELLS}`,
    );

  const wrongVersion = await db.territoryCell.count({
    where: { retiredAt: null, gridVersion: { not: TARGET_GRID_VERSION } },
  });
  if (wrongVersion !== 0)
    throw new Error(
      `${wrongVersion} live cells are not on grid version ${TARGET_GRID_VERSION}`,
    );

  const onRetired = await db.territoryCellOwnership.count({
    where: { closedAt: null, cell: { retiredAt: { not: null } } },
  });
  if (onRetired !== 0)
    throw new Error(`${onRetired} retired cells still have an open owner`);

  const open = await db.territoryCellOwnership.count({
    where: { closedAt: null },
  });
  if (open !== plan.ownerships.length)
    throw new Error(
      `${open} cells have an open owner, the plan said ${plan.ownerships.length}`,
    );

  const strayDuels = await db.contest.count({
    where: {
      status: { in: OPEN_DUEL_STATUSES },
      OR: [
        { cell: { retiredAt: { not: null } } },
        { pledgedCell: { retiredAt: { not: null } } },
      ],
    },
  });
  if (strayDuels !== 0)
    throw new Error(`${strayDuels} open duels still point at retired cells`);
}

/** Plain text for the console. Only counts and public usernames, never emails or ids. */
export function formatRegridReport(report: RegridReport): string {
  const out: string[] = [];
  if (report.status === 'already-current') {
    out.push(
      `The live map is already on grid version ${report.gridVersion} (${report.liveCellsBefore} cells). Nothing to do.`,
    );
    return out.join('\n');
  }

  out.push(
    'zone                        old  owned  new  owned-after  moved  dropped',
  );
  for (const z of report.zones) {
    out.push(
      `${z.zoneId.padEnd(26)} ${String(z.oldCells).padStart(4)} ${String(z.ownedOld).padStart(6)} ${String(z.newCells).padStart(4)} ${String(z.inherited).padStart(12)} ${String(z.viaNearest).padStart(6)} ${String(z.dropped).padStart(8)}`,
    );
  }
  out.push('');
  out.push(
    `Cells:            ${report.liveCellsBefore} live now -> ${report.liveCellsAfter} (${report.retiredCells} get retired, none are deleted)`,
  );
  out.push(
    `Owned cells:      ${report.ownedCellsBefore} -> ${report.ownedCellsAfter}, held by ${report.owners} players`,
  );
  out.push(
    `Players with fewer cells afterwards: ${report.ownersWithFewerCells}`,
  );
  out.push(
    `Ownerships that could not be carried over: ${report.droppedOwnerships}`,
  );
  out.push(
    `Open duels:       ${report.duelsRemapped} move to the new cells, ${report.duelsCancelled} are cancelled`,
  );
  if (report.topOwners.length > 0) {
    out.push('');
    out.push('Biggest holders (cells before -> after):');
    for (const o of report.topOwners)
      out.push(`  ${o.username.padEnd(24)} ${o.before} -> ${o.after}`);
  }
  out.push('');
  out.push(
    report.status === 'applied'
      ? 'Applied. The map is now on the new grid.'
      : 'Dry run: nothing was written. Re-run with --apply to make the change.',
  );
  return out.join('\n');
}
