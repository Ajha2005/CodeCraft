// backend/prisma/wipe-territories.ts
//
// Deletes every Territory row and every whole-territory ownership (the
// pre-cell ownership table). It does not touch cells: the database refuses to
// delete a territory that still has cells, so clear those first with
// reset-grid.ts. Use it only to start the territory table over before
// re-running the seed.
//
// Dry run by default: it prints what it would delete and changes nothing.
// Pass --apply to delete (the same flag regrid.ts and reset-grid.ts use). The
// delete is one transaction.
//
// Usage:
//   npx tsx prisma/wipe-territories.ts            what would be deleted
//   npx tsx prisma/wipe-territories.ts --apply    delete it
import 'dotenv/config';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const args = process.argv.slice(2);
const unknown = args.filter((a) => a !== '--apply');
if (unknown.length > 0) {
  console.error(
    `Unknown option(s): ${unknown.join(' ')}\nUsage: tsx prisma/wipe-territories.ts [--apply]`,
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
    const [ownerships, territories, cells] = await Promise.all([
      prisma.territoryOwnership.count(),
      prisma.territory.count(),
      prisma.territoryCell.count(),
    ]);
    console.log(
      `This would permanently delete ${ownerships} territory_ownerships and ${territories} territories rows.`,
    );

    if (cells > 0) {
      console.error(
        `\nNot deleting anything: ${cells} territory_cells still belong to these territories. Run reset-grid.ts --apply first.`,
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

    const [deletedOwnerships, deletedTerritories] = await prisma.$transaction([
      prisma.territoryOwnership.deleteMany({}),
      prisma.territory.deleteMany({}),
    ]);
    console.log(
      `\nDeleted ${deletedOwnerships.count} ownership rows and ${deletedTerritories.count} territory rows.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(
    `\nwipe-territories failed: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
