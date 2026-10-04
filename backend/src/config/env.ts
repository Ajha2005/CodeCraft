// Environment handling in one place: read it once at startup and refuse to
// boot on a missing or weak setting, instead of failing later inside some
// request handler. Nothing here ever prints a value, only the names of the
// settings that are wrong.

export const MIN_JWT_SECRET_LENGTH = 32;

// Values that show up in tutorials, templates and old versions of this repo.
// A secret that appears in the source tree is public, so it can never be used.
const KNOWN_WEAK_SECRETS = new Set([
  'dev_secret_change_this_in_production',
  'secret',
  'jwt_secret',
  'jwtsecret',
  'changeme',
  'change_me',
  'change-me',
  'your_jwt_secret_here',
  'supersecret',
  'password',
  'default',
  'test',
]);

type Env = Record<string, string | undefined>;

export function isProduction(env: Env = process.env): boolean {
  return env.NODE_ENV === 'production';
}

/** Why a JWT secret is unusable, or null when it is fine. The secret itself is never echoed. */
export function jwtSecretProblem(secret: string | undefined): string | null {
  if (!secret) return 'JWT_SECRET is not set';
  if (secret.length < MIN_JWT_SECRET_LENGTH) {
    return `JWT_SECRET is too short (need at least ${MIN_JWT_SECRET_LENGTH} characters)`;
  }
  if (KNOWN_WEAK_SECRETS.has(secret.trim().toLowerCase())) {
    return 'JWT_SECRET is a well-known placeholder value';
  }
  if (new Set(secret).size < 8) {
    return 'JWT_SECRET has too little variety (generate one with `openssl rand -base64 48`)';
  }
  return null;
}

/** The signing secret, or an Error saying what is wrong with it. */
export function readJwtSecret(env: Env = process.env): string {
  const problem = jwtSecretProblem(env.JWT_SECRET);
  if (problem) throw new Error(problem);
  return env.JWT_SECRET as string;
}

function normalizeOrigin(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin.toLowerCase(); // scheme + host + port, no path, no trailing slash
  } catch {
    return null;
  }
}

function isLocalOrigin(origin: string): boolean {
  const host = new URL(origin).hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost');
}

/** Browser origins allowed to call the API (REST and both WebSocket gateways). */
export function corsAllowlist(env: Env = process.env): string[] {
  const configured = [env.FRONTEND_URL, ...(env.CORS_ORIGINS ?? '').split(',')]
    .map((value) => (value ? normalizeOrigin(value) : null))
    .filter((value): value is string => value !== null);

  // Local development origins are only ever allowed outside production.
  const dev = isProduction(env) ? [] : ['http://localhost:5173', 'http://localhost:5174', 'http://127.0.0.1:5173'];
  const all = [...configured, ...dev];
  return [...new Set(isProduction(env) ? all.filter((origin) => !isLocalOrigin(origin)) : all)];
}

/** Requests without an Origin header are not browser cross-site calls, so CORS has nothing to say about them. */
export function isAllowedOrigin(origin: string | undefined, env: Env = process.env): boolean {
  if (!origin) return true;
  const normalized = normalizeOrigin(origin);
  return normalized !== null && corsAllowlist(env).includes(normalized);
}

/** How many reverse proxies sit in front of the app (Nginx = 1). Without a proxy the socket address is the client. */
export function trustProxyHops(env: Env = process.env): number {
  const raw = env.TRUST_PROXY_HOPS;
  if (raw !== undefined && raw !== '') {
    const hops = Number(raw);
    if (!Number.isInteger(hops) || hops < 0 || hops > 5) throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 5');
    return hops;
  }
  return isProduction(env) ? 1 : 0;
}

/** Loopback by default: only the local Nginx (or a dev frontend) can reach the app. */
export function listenHost(env: Env = process.env): string {
  return env.HOST?.trim() || '127.0.0.1';
}

export function listenPort(env: Env = process.env): number {
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a number from 1 to 65535');
  return port;
}

/** Whether the old email + password sign-in is switched on (off unless PASSWORD_LOGIN_ENABLED=true). */
export function passwordLoginEnabled(env: Env = process.env): boolean {
  return env.PASSWORD_LOGIN_ENABLED === 'true';
}

/** How long a user's access token lives, e.g. "12h". Guests always get 2 hours. */
export function accessTokenTtl(env: Env = process.env): string {
  const value = env.JWT_EXPIRES_IN?.trim() || '12h';
  if (!/^\d+[smhd]$/.test(value)) throw new Error('JWT_EXPIRES_IN must look like 30m, 12h or 7d');
  return value;
}

/** Collects every problem so one boot attempt reports them all. Throws an Error naming the settings, never their values. */
export function validateEnv(env: Env = process.env): void {
  const problems: string[] = [];

  const jwtProblem = jwtSecretProblem(env.JWT_SECRET);
  if (jwtProblem) problems.push(jwtProblem);

  for (const name of ['DATABASE_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_CALLBACK_URL']) {
    if (!env[name]?.trim()) problems.push(`${name} is not set`);
  }

  try {
    accessTokenTtl(env);
    trustProxyHops(env);
    listenPort(env);
  } catch (err) {
    problems.push((err as Error).message);
  }

  if (isProduction(env)) {
    if (!env.REDIS_URL?.trim()) problems.push('REDIS_URL is not set');
    if (!env.FRONTEND_URL?.trim()) {
      problems.push('FRONTEND_URL is not set (it is the site allowed to call the API and where Google sign-in returns to)');
    }
    const configured = [env.FRONTEND_URL, ...(env.CORS_ORIGINS ?? '').split(',')]
      .map((value) => (value ? normalizeOrigin(value) : null))
      .filter((value): value is string => value !== null);
    if (configured.some(isLocalOrigin)) problems.push('FRONTEND_URL / CORS_ORIGINS must not point at localhost in production');
    if (corsAllowlist(env).length === 0) problems.push('no valid https origin is configured in FRONTEND_URL / CORS_ORIGINS');
  }

  if (problems.length > 0) {
    throw new Error(`Refusing to start, fix the environment first:\n - ${problems.join('\n - ')}`);
  }
}
