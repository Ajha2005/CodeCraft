// backend/prisma/check-capacity.ts
//
// Read-only: does the map have enough cells for everyone's solves?
//
// A solve never takes another player's cell, so every solve that earns points
// needs a free cell of its own. With 100 players each solving 100 problems that
// is 10,000 cells. Nothing is changed in the database.
//
// Usage:
//   npx tsx prisma/check-capacity.ts                     # 100 users x 100 solves
//   npx tsx prisma/check-capacity.ts --users=300 --solves=100
import 'dotenv/config';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const arg = (name: string, fallback: number) => {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const USERS = arg('users', 100);
const SOLVES = arg('solves', 100);
const NEEDED = USERS * SOLVES;

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const cells = await prisma.territoryCell.findMany({
    select: { territory: { select: { tier: true } }, ownerships: { where: { closedAt: null }, select: { id: true } } },
  });

  const tiers: Record<string, { total: number; taken: number }> = {};
  for (const c of cells) {
    const t = (tiers[c.territory.tier] ??= { total: 0, taken: 0 });
    t.total += 1;
    if (c.ownerships.length > 0) t.taken += 1;
  }

  const total = cells.length;
  const taken = Object.values(tiers).reduce((s, t) => s + t.taken, 0);
  console.log(`Cells on the map: ${total} (${taken} taken, ${total - taken} free)\n`);
  for (const tier of ['OUTPOST', 'SETTLEMENT', 'STRONGHOLD', 'CITADEL']) {
    const t = tiers[tier] ?? { total: 0, taken: 0 };
    console.log(`  ${tier.padEnd(11)} ${String(t.total).padStart(6)} cells, ${String(t.total - t.taken).padStart(6)} free`);
  }

  console.log(`\nNeeded for ${USERS} users x ${SOLVES} solves: ${NEEDED} cells`);
  if (total >= NEEDED) {
    console.log(`OK - ${total - NEEDED} to spare (${Math.round(((total - NEEDED) / NEEDED) * 100)}% headroom).`);
  } else {
    console.log(`NOT ENOUGH - ${NEEDED - total} cells short.`);
    console.log('A smaller grid size gives more cells. See `npx tsx prisma/generate-grid.ts --dry-run --size=18`.');
    console.log('Changing the size rebuilds the grid and erases who holds which cell (see reset-grid.ts), so decide before launch.');
    process.exitCode = 1;
  }
}

main().finally(() => prisma.$disconnect());
