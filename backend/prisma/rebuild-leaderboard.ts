// backend/prisma/rebuild-leaderboard.ts
//
// Refills the college leaderboard in Redis (`leaderboard:college`) from
// Postgres. Redis Cloud's free plan keeps no data across a restart or an
// eviction, so after one the board is empty until this runs. (The server also
// does this by itself when it starts and finds the board empty; this script is
// for doing it by hand, or for forcing a rebuild.)
//
//   npx tsx prisma/rebuild-leaderboard.ts            dry run: says what it would do
//   npx tsx prisma/rebuild-leaderboard.ts --apply    refill the board if it is empty
//   npx tsx prisma/rebuild-leaderboard.ts --apply --force
//                                                    replace the board even if it has entries
//
// Postgres is never written. The new board is built beside the old one and
// swapped in with a single RENAME, so readers never see it half filled.
import 'dotenv/config';
import Redis from 'ioredis';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { rebuildCollegeLeaderboard } from '../src/leaderboard/leaderboard-rebuild';

const args = process.argv.slice(2);
const unknown = args.filter((a) => a !== '--apply' && a !== '--force');
if (unknown.length > 0) {
  console.error(
    `Unknown option(s): ${unknown.join(' ')}\nUsage: tsx prisma/rebuild-leaderboard.ts [--apply] [--force]`,
  );
  process.exit(2);
}
const APPLY = args.includes('--apply');
const FORCE = args.includes('--force');

function hostOf(raw: string | undefined): string {
  try {
    const url = new URL(raw ?? '');
    return `${url.hostname}:${url.port || '(default port)'}`; // never the password
  } catch {
    return '(not set or not a URL)';
  }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  if (!process.env.REDIS_URL) throw new Error('REDIS_URL is not set');
  console.log(`Postgres: ${hostOf(process.env.DATABASE_URL)}`);
  console.log(`Redis:    ${hostOf(process.env.REDIS_URL)}`);
  console.log(
    APPLY
      ? `Mode: APPLY${FORCE ? ' --force' : ''}\n`
      : 'Mode: dry run (reads only)\n',
  );

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const redis = new Redis(process.env.REDIS_URL, {
    connectTimeout: 10_000,
    maxRetriesPerRequest: 2,
  });
  try {
    const result = await rebuildCollegeLeaderboard(prisma, redis, {
      force: FORCE,
      dryRun: !APPLY,
    });
    switch (result.status) {
      case 'skipped-not-empty':
        console.log(
          `The board already has ${result.existing} players, so it was left alone. Use --force to replace it.`,
        );
        break;
      case 'nothing-to-write':
        console.log(
          'Nobody has a score in Postgres yet, so there is nothing to put on the board.',
        );
        break;
      case 'would-rebuild':
        console.log(
          `Would write ${result.entries} players to the board (${result.existing} there now). Re-run with --apply.`,
        );
        break;
      case 'rebuilt':
        console.log(
          `Rebuilt the board: ${result.entries} players (${result.existing} before).`,
        );
        break;
    }
  } finally {
    redis.disconnect();
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(
    `\nrebuild-leaderboard failed: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
