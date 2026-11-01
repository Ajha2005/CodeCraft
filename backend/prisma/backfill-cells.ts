// backend/prisma/backfill-cells.ts
//
// Gives every past scored solve that has no cell a cell of its own, oldest
// solves first, using exactly the rules a live solve follows (free ground only,
// same tier first). Meant for right after the grid has been rebuilt
// (reset-grid.ts + generate-grid.ts), which erases who held which cell: players
// keep one cell per solved problem instead of starting from nothing.
//
// Safe to run again: a solve that already has a cell is skipped. Stop the
// backend while it runs so no live solve competes for the same cells.
//
// Usage:
//   npx tsx prisma/backfill-cells.ts --dry-run   # count only, changes nothing
//   npx tsx prisma/backfill-cells.ts
import 'dotenv/config';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { allocateFreeCell } from '../src/submissions/cell-allocator';
import { ScoringService } from '../src/scoring/scoring.service';

const DRY_RUN = process.argv.includes('--dry-run');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
const scoring = new ScoringService();

async function main() {
  const scores = await prisma.performanceScore.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      totalScore: true,
      submission: {
        select: { id: true, userId: true, cellOwnerships: { where: { sourceType: 'solve' }, select: { id: true } } },
      },
    },
  });
  const todo = scores.filter((s) => s.submission.cellOwnerships.length === 0);
  console.log(`${scores.length} scored solves, ${todo.length} without a cell.`);
  if (DRY_RUN || todo.length === 0) {
    if (DRY_RUN) console.log('--dry-run set, nothing written.');
    return;
  }

  let given = 0;
  let none = 0;
  for (const s of todo) {
    const tier = scoring.getTerritoryTier(s.totalScore);
    const cell = await prisma.$transaction((tx) => allocateFreeCell(tx, s.submission.userId, tier, s.submission.id));
    if (cell) given += 1;
    else none += 1;
  }
  console.log(`Gave ${given} cells${none ? `; ${none} solves got none because the map is full` : ''}.`);
}

main().finally(() => prisma.$disconnect());
