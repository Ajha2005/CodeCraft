// Guard rails for the tests that need a real Postgres and Redis. They only ever
// run against a throwaway local database named in TEST_DATABASE_URL and
// TEST_REDIS_URL, never against DATABASE_URL / REDIS_URL (which a developer's
// .env may point at production), and they refuse anything that is not on this
// machine. See test/README.md.
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export interface ScratchUrls {
  databaseUrl: string;
  redisUrl: string;
}

function assertLocal(raw: string, name: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} is not a URL`);
  }
  if (!LOCAL_HOSTS.has(url.hostname))
    throw new Error(
      `${name} must point at this machine (localhost / 127.0.0.1), refusing to run against ${url.hostname}`,
    );
  return url;
}

/** The scratch URLs, or null when the environment does not provide them (the DB-backed tests then skip). */
export function scratchUrls(
  env: NodeJS.ProcessEnv = process.env,
): ScratchUrls | null {
  const databaseUrl = env.TEST_DATABASE_URL;
  const redisUrl = env.TEST_REDIS_URL;
  if (!databaseUrl || !redisUrl) return null;
  const db = assertLocal(databaseUrl, 'TEST_DATABASE_URL');
  if (!/test|scratch|tmp/i.test(db.pathname))
    throw new Error(
      'TEST_DATABASE_URL must name a database with "test", "scratch" or "tmp" in it',
    );
  assertLocal(redisUrl, 'TEST_REDIS_URL');
  return { databaseUrl, redisUrl };
}

export function scratchPrisma(databaseUrl: string): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
}

/** Empties every table except Prisma's own bookkeeping. */
export async function emptyDatabase(prisma: PrismaClient): Promise<void> {
  const tables = await prisma.$queryRaw<
    { tablename: string }[]
  >`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0)
    throw new Error(
      'The scratch database has no tables, run `npx prisma migrate deploy` against it first',
    );
  const list = tables.map((t) => `"${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`,
  );
}
