import { randomUUID } from 'crypto';
import type { Redis } from 'ioredis';
import type { PrismaClient } from '../../generated/prisma/client';
import { COLLEGE_LEADERBOARD_KEY } from '../common/redis/leaderboard-redis.service';

/**
 * The college leaderboard lives in Redis, and the Redis Cloud free plan does not
 * persist anything: a restart or an eviction empties the board. Postgres has
 * everything needed to put it back, because a player's score is the sum of their
 * performance scores. This does that.
 */

export interface RebuildOptions {
  /** Replace a board that already has entries. Without it a non-empty board is left alone. */
  force?: boolean;
  /** Work out what would happen without writing. */
  dryRun?: boolean;
}

export interface RebuildResult {
  status:
    'rebuilt' | 'would-rebuild' | 'skipped-not-empty' | 'nothing-to-write';
  /** Players that are, or in a dry run would be, on the board afterwards. */
  entries: number;
  /** Players on the board before. */
  existing: number;
}

const CHUNK = 500;

export async function collegeScoresFromDatabase(
  prisma: Pick<PrismaClient, '$queryRaw'>,
): Promise<{ userId: string; score: number }[]> {
  const rows = await prisma.$queryRaw<{ userId: string; score: number }[]>`
    SELECT s."userId" AS "userId", SUM(p."totalScore")::float8 AS "score"
    FROM performance_scores p
    JOIN submissions s ON s."id" = p."submissionId"
    GROUP BY s."userId"`;
  return rows.map((r) => ({ userId: r.userId, score: Number(r.score) }));
}

export async function rebuildCollegeLeaderboard(
  prisma: Pick<PrismaClient, '$queryRaw'>,
  redis: Pick<Redis, 'zcard' | 'zadd' | 'rename' | 'del'>,
  options: RebuildOptions = {},
): Promise<RebuildResult> {
  const existing = await redis.zcard(COLLEGE_LEADERBOARD_KEY);
  if (existing > 0 && !options.force)
    return { status: 'skipped-not-empty', entries: existing, existing };

  const scores = await collegeScoresFromDatabase(prisma);
  if (scores.length === 0)
    return { status: 'nothing-to-write', entries: existing, existing };
  if (options.dryRun)
    return { status: 'would-rebuild', entries: scores.length, existing };

  // Build the new board beside the old one and swap it in with a single atomic RENAME,
  // so readers never see a half-filled board.
  const temp = `${COLLEGE_LEADERBOARD_KEY}:rebuild:${randomUUID()}`;
  try {
    for (let i = 0; i < scores.length; i += CHUNK) {
      await redis.zadd(
        temp,
        ...scores.slice(i, i + CHUNK).flatMap((e) => [e.score, e.userId]),
      );
    }
    await redis.rename(temp, COLLEGE_LEADERBOARD_KEY);
  } finally {
    await redis.del(temp).catch(() => undefined); // gone already after a successful RENAME
  }
  return { status: 'rebuilt', entries: scores.length, existing };
}
