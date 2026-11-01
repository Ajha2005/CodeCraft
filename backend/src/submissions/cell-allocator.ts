import type { PrismaClient } from '../../generated/prisma/client';

// Which cell a solve earns. Shared by the judge worker (a live solve) and the
// backfill script (re-awarding cells to old solves after the grid is rebuilt),
// so both follow exactly the same rules.

/** Cell allocation reads and writes the same two tables whether it runs on the plain client or inside a transaction. */
export type CellDb = Pick<PrismaClient, 'territoryCell' | 'territoryCellOwnership'>;

export interface ClaimedCell {
  id: string;
  territoryId: string;
  row: number;
  col: number;
}

const TIER_ORDER = ['OUTPOST', 'SETTLEMENT', 'STRONGHOLD', 'CITADEL'];

/** The tier itself, then the others by how near they are, lower tiers before higher ones. */
export function tiersByCloseness(tier: string): string[] {
  const at = Math.max(0, TIER_ORDER.indexOf(tier));
  return [...TIER_ORDER].sort((a, b) => {
    const da = Math.abs(TIER_ORDER.indexOf(a) - at);
    const db = Math.abs(TIER_ORDER.indexOf(b) - at);
    return da - db || TIER_ORDER.indexOf(a) - TIER_ORDER.indexOf(b);
  });
}

function isAdjacent(a: { row: number; col: number }, b: { row: number; col: number }) {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;
}

/**
 * Picks the one cell a correct solve earns and writes the ownership, announcing
 * nothing: the caller broadcasts once the write is committed.
 *
 * A solve only ever hands out ground nobody holds: it never takes a cell from
 * another player (cells change hands only through a duel both sides accepted),
 * so every player's cells are theirs alone. In order of preference:
 *   1. a free cell touching the cells the player already holds in this tier
 *   2. any other free cell in the zones they already hold
 *   3. any free cell in the tier
 *   4. when the tier is full, a free cell in the nearest other tier (lower
 *      tiers first), so the solve still earns ground
 * Returns null only when no cell on the whole map is free.
 */
export async function allocateFreeCell(
  db: CellDb,
  userId: string,
  tier: string,
  submissionId: string | undefined,
  log: (message: string) => void = () => {},
): Promise<ClaimedCell | null> {
  const owned = await db.territoryCellOwnership.findMany({
    where: { userId, closedAt: null, cell: { territory: { tier } } },
    include: { cell: true },
  });
  const mine = owned.map((o) => o.cell);

  // Every cell of the zones they already hold, with its current owner.
  const nearby = mine.length
    ? await db.territoryCell.findMany({
        where: { territoryId: { in: [...new Set(mine.map((c) => c.territoryId))] } },
        include: { ownerships: { where: { closedAt: null } } },
        orderBy: [{ row: 'asc' }, { col: 'asc' }],
      })
    : [];

  const touchesMine = (cell: { territoryId: string; row: number; col: number }) =>
    mine.some((own) => own.territoryId === cell.territoryId && isAdjacent(own, cell));

  const freeNearby = nearby.filter((c) => c.ownerships.length === 0);
  const free = freeNearby.find(touchesMine) ?? freeNearby[0];
  if (free) return claimCell(db, userId, tier, free, submissionId, log);

  for (const candidate of tiersByCloseness(tier)) {
    const freeInTier = await db.territoryCell.findFirst({
      where: { territory: { tier: candidate }, ownerships: { none: { closedAt: null } } },
      orderBy: [{ territory: { name: 'asc' } }, { row: 'asc' }, { col: 'asc' }],
    });
    if (freeInTier) return claimCell(db, userId, candidate, freeInTier, submissionId, log);
  }

  log(`No free cell anywhere for user ${userId} (wanted ${tier}) — every cell is taken or seed data is missing.`);
  return null;
}

async function claimCell(
  db: CellDb,
  userId: string,
  tier: string,
  cell: ClaimedCell,
  submissionId: string | undefined,
  log: (message: string) => void,
): Promise<ClaimedCell> {
  await db.territoryCellOwnership.create({
    data: { cellId: cell.id, userId, sourceType: 'solve', submissionId, captured: false },
  });
  log(`Assigned unclaimed ${tier} cell ${cell.id} (territory ${cell.territoryId}) to user ${userId}`);
  return cell;
}
