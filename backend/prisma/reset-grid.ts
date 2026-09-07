// backend/prisma/reset-grid.ts
//
// Clears TerritoryCell rows (and their TerritoryCellOwnership history) so
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
  const [cellCount, ownershipCount] = await Promise.all([
    prisma.territoryCell.count(),
    prisma.territoryCellOwnership.count(),
  ]);

  console.log(
    `This will permanently delete ${cellCount} territory_cells and ${ownershipCount} territory_cell_ownerships rows.`,
  );

  if (!CONFIRMED) {
    console.log('\nRe-run with --yes to actually delete. Nothing was changed.');
    return;
  }

  const ownerships = await prisma.territoryCellOwnership.deleteMany({});
  console.log(`Deleted ${ownerships.count} territory_cell_ownerships rows.`);

  const cells = await prisma.territoryCell.deleteMany({});
  console.log(`Deleted ${cells.count} territory_cells rows.`);

  console.log('\nGrid cleared. Now reseed at your chosen size, e.g.:');
  console.log('  npx tsx prisma/generate-grid.ts --size=18.5');
}

main().finally(() => prisma.$disconnect());
