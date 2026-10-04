import type { ConnectionOptions } from 'bullmq';

/**
 * Connection settings for BullMQ, from the same REDIS_URL the rest of the app
 * uses (redis:// or rediss://). Handing BullMQ plain options rather than a
 * ready-made client means it opens its own connections and closes them again on
 * shutdown; a client we created ourselves would be left open.
 */
export function bullConnectionFromUrl(
  raw: string | undefined,
): ConnectionOptions {
  if (!raw) return { host: 'localhost', port: 6379 };
  const url = new URL(raw);
  const db =
    url.pathname.length > 1 ? Number(url.pathname.slice(1)) : undefined;
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: Number.isInteger(db) ? db : undefined,
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}
