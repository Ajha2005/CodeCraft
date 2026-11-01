// backend/prisma/reset-grid.ts
//
// Clears TerritoryCell rows (and their TerritoryCellOwnership history, and any
// duels, which point at cells and cannot outlive them) so
// generate-grid.ts can be re-run at a different --size without leaving the
// old grid's cells mixed in alongside the new ones — generate-grid.ts only
// ever inserts, it never removes stale rows from a previous grid size.
//
// This does NOT touch Territory or TerritoryOwnership (whole-territory
// ownership) — only the per-cell grid and per-cell capture history.
//
// Destructive — permanently erases who has captured which cell. Requires
// --yes so it can't be triggered by an accidental `npm run reset-grid`.
//
// Usage:
//   npx tsx prisma/reset-grid.ts --yes
//   npx tsx prisma/generate-grid.ts --size=18.5
import 'dotenv/config';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const CONFIRMED = process.argv.includes('--yes');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const [cellCount, ownershipCount, contestCount] = await Promise.all([
    prisma.territoryCell.count(),
    prisma.territoryCellOwnership.count(),
    prisma.contest.count(),
  ]);

  console.log(
    `This will permanently delete ${cellCount} territory_cells, ${ownershipCount} territory_cell_ownerships and ${contestCount} contests (duels) rows.`,
  );

  if (!CONFIRMED) {
    console.log('\nRe-run with --yes to actually delete. Nothing was changed.');
    return;
  }

  // Duels name the cell fought over (and the one staked), so they go first. The
  // submissions made inside a duel stay, just no longer tied to it.
  await prisma.$transaction(async (tx) => {
    await tx.contestParticipant.deleteMany({});
    await tx.submission.updateMany({ where: { contestId: { not: null } }, data: { contestId: null } });
    const contests = await tx.contest.deleteMany({});
    console.log(`Deleted ${contests.count} contests rows.`);

    const ownerships = await tx.territoryCellOwnership.deleteMany({});
    console.log(`Deleted ${ownerships.count} territory_cell_ownerships rows.`);

    const cells = await tx.territoryCell.deleteMany({});
    console.log(`Deleted ${cells.count} territory_cells rows.`);
  });

  console.log('\nGrid cleared. Now reseed at your chosen size, e.g.:');
  console.log('  npx tsx prisma/generate-grid.ts --size=18.5');
}

main().finally(() => prisma.$disconnect());
