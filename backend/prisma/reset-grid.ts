// backend/prisma/reset-grid.ts
//
// Deletes EVERY TerritoryCell row and its TerritoryCellOwnership history, so the
// map can be rebuilt from nothing with prisma/regrid.ts. It is the only script
// here that erases who captured what.
//
// It does NOT touch Territory or TerritoryOwnership (whole-territory
// ownership), only the per-cell grid and the per-cell capture history.
//
// Dry run by default: it prints what it would delete and changes nothing.
// Pass --apply to delete. (This flag replaces the old --yes, and is the same
// one regrid.ts and wipe-territories.ts use.) The delete is one transaction, and
// it refuses to run while any duel still points at a cell, because deleting the
// cells would either fail halfway or wipe the duel history with them.
//
// Usage:
//   npx tsx prisma/reset-grid.ts            what would be deleted
//   npx tsx prisma/reset-grid.ts --apply    delete it
//   npx tsx prisma/regrid.ts --apply        then rebuild the 1000-cell map
//
// To move a live map to a new grid WITHOUT losing ownership, do not reset it:
// use regrid.ts, which retires the old cells instead of deleting them.
import 'dotenv/config';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const args = process.argv.slice(2);
const unknown = args.filter((a) => a !== '--apply');
if (unknown.length > 0) {
  console.error(
    `Unknown option(s): ${unknown.join(' ')}\nUsage: tsx prisma/reset-grid.ts [--apply]`,
  );
  process.exit(2);
}
const APPLY = args.includes('--apply');

function describeTarget(): string {
  try {
    const url = new URL(process.env.DATABASE_URL ?? '');
    return `${url.hostname}:${url.port || '5432'}${url.pathname}`; // never the user or password
  } catch {
    return '(DATABASE_URL is not set or not a URL)';
  }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    console.log(`Database: ${describeTarget()}`);
    const [cells, ownerships, contests] = await Promise.all([
      prisma.territoryCell.count(),
      prisma.territoryCellOwnership.count(),
      prisma.contest.count(),
    ]);
    console.log(
      `This would permanently delete ${cells} territory_cells and ${ownerships} territory_cell_ownerships rows.`,
    );

    if (contests > 0) {
      console.error(
        `\nNot deleting anything: ${contests} contests still refer to cells. Resolve or remove them first.`,
      );
      process.exitCode = 1;
      return;
    }
    if (!APPLY) {
      console.log(
        '\nDry run: nothing was changed. Re-run with --apply to delete.',
      );
      return;
    }

    const [deletedOwnerships, deletedCells] = await prisma.$transaction([
      prisma.territoryCellOwnership.deleteMany({}),
      prisma.territoryCell.deleteMany({}),
    ]);
    console.log(
      `\nDeleted ${deletedOwnerships.count} territory_cell_ownerships and ${deletedCells.count} territory_cells rows.`,
    );
    console.log(
      'Grid cleared. Rebuild the map with:  npx tsx prisma/regrid.ts --apply',
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(
    `\nreset-grid failed: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
