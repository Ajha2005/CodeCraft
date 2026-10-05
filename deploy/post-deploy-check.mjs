#!/usr/bin/env node
// =============================================================================
// post-deploy-check.mjs: smoke test of a deployed CodeCraft API.
//
//   node deploy/post-deploy-check.mjs https://api.yourdomain.com \
//        [--frontend https://app.yourdomain.com] [--origin-ip 203.0.113.7] [--skip-run]
//
// Run it after a release, from your own computer (it then sees the API the way a
// visitor does, through Cloudflare, Nginx and TLS) and again whenever something
// looks wrong. Node >= 20, no dependencies.
//
// Safe against production. It asks for ONE demo (guest) token and runs two tiny
// sample programs; neither writes a row to the database, and it never signs in as
// a real person. Everything else is a plain GET, a request that must be refused,
// or a forged token that must be rejected.
//
//   --frontend URL   the deployed frontend's origin; checks the API lets it in (CORS)
//   --origin-ip IP   the EC2 box's public IP; checks ports 3000 and 2000 are closed
//   --skip-run       skip the two sample runs (when Piston is deliberately off)
//
// Exit status: 0 nothing failed (warnings are allowed), 1 a check failed, 2 bad arguments.
// =============================================================================
import { createHmac } from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';

// ----- arguments --------------------------------------------------------------
const argv = process.argv.slice(2);
const option = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};
const usage = 'usage: node deploy/post-deploy-check.mjs <https://api.host> [--frontend <origin>] [--origin-ip <ip>] [--skip-run]';
const BASE = (argv[0] ?? '').replace(/\/+$/, '');
if (!/^https?:\/\/[^/\s]+$/.test(BASE)) {
  console.error(`The first argument must be the API's base URL, for example https://api.yourdomain.com\n${usage}`);
  process.exit(2);
}
const FRONTEND = option('--frontend')?.replace(/\/+$/, '');
const ORIGIN_IP = option('--origin-ip');
const SKIP_RUN = argv.includes('--skip-run');
const IS_HTTPS = BASE.startsWith('https://');
const HOST = new URL(BASE).hostname;

// The JWT secret that used to be the fallback in the source (it is in the repository history, so
// it must never be accepted again). Add --try-secret <value> to test another one.
const OLD_SECRETS = ['dev_secret_change_this_in_production', ...(option('--try-secret') ? [option('--try-secret')] : [])];
const STRANGER = 'https://evil.example.invalid';

// ----- helpers ----------------------------------------------------------------
class Failure extends Error {}
const ensure = (condition, message) => {
  if (!condition) throw new Failure(message);
};

async function api(method, path, { token, json, headers = {}, base = BASE } = {}) {
  const res = await fetch(base + path, {
    method,
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
    headers: {
      accept: 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  return { status: res.status, headers: res.headers, text, body };
}

/** Names of the keys anywhere in `value` that must never reach a browser. */
function leakedKeys(value, found = new Set()) {
  const forbidden = new Set(['email', 'passwordhash', 'googleid', 'testcases', 'test_cases', 'hiddentestcases', 'hidden_tests']);
  if (Array.isArray(value)) value.forEach((item) => leakedKeys(item, found));
  else if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      if (forbidden.has(key.toLowerCase())) found.add(key);
      leakedKeys(inner, found);
    }
  }
  return [...found];
}

const exactKeys = (object, keys) => JSON.stringify(Object.keys(object).sort()) === JSON.stringify([...keys].sort());
const b64url = (data) => Buffer.from(data).toString('base64url');

/** A JWT built by hand. `secret === null` leaves the signature empty (alg "none" attack). */
function forge({ secret, claims, alg = 'HS256' }) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg, typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iat: now, exp: now + 3600, iss: 'codecraft-api', aud: 'codecraft-app', ...claims }));
  const signature = secret === null ? '' : createHmac(alg === 'HS384' ? 'sha384' : 'sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

function tcpOpen(host, port, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (isOpen) => {
      socket.destroy();
      resolve(isOpen);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

function certificateDaysLeft(host, port = 443) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, servername: host, timeout: 10_000 }, () => {
      const validTo = socket.getPeerCertificate().valid_to;
      socket.end();
      resolve((new Date(validTo).getTime() - Date.now()) / 86_400_000);
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error('timed out'));
    });
    socket.once('error', reject);
  });
}

// ----- runner -----------------------------------------------------------------
const tally = { PASS: 0, WARN: 0, FAIL: 0, SKIP: 0 };
const state = { token: null, problemId: null };

/** fn returns nothing or a detail string (pass), { warn }, { skip }, or throws (fail). */
async function check(name, fn) {
  let tag = 'PASS';
  let detail = '';
  try {
    const result = await fn();
    if (typeof result === 'string') detail = result;
    else if (result?.warn) [tag, detail] = ['WARN', result.warn];
    else if (result?.skip) [tag, detail] = ['SKIP', result.skip];
  } catch (err) {
    tag = 'FAIL';
    detail = err instanceof Failure ? err.message : `${err.name}: ${err.message}`;
  }
  tally[tag] += 1;
  console.log(`${tag}  ${name}${detail ? `\n      ${detail}` : ''}`);
}

const needsGuest = () => (state.token ? null : { skip: 'no demo session (see the failed check above)' });

console.log(`CodeCraft post-deploy check: ${BASE}\n`);

// ===== Is it up? ===============================================================
await check('Liveness: GET /health', async () => {
  const res = await api('GET', '/health');
  ensure(res.status === 200 && res.body?.status === 'ok', `answered ${res.status}; is Nginx pointing at 127.0.0.1:3000 and the backend running (pm2 list)?`);
});

await check('Readiness: database and Redis answer (GET /health/ready)', async () => {
  const res = await api('GET', '/health/ready');
  ensure(res.status === 200 && res.body?.db === 'up' && res.body?.redis === 'up', `answered ${res.status} ${res.text.slice(0, 120)}`);
});

await check('TLS certificate has weeks left', async () => {
  if (!IS_HTTPS) return { skip: 'not an https address' };
  const days = await certificateDaysLeft(HOST);
  ensure(days > 7, `the certificate expires in ${days.toFixed(0)} days; renew it (certbot renew)`);
  return days < 21 ? { warn: `${days.toFixed(0)} days left; certbot should have renewed by now (certbot renew --dry-run)` } : `${days.toFixed(0)} days left`;
});

await check('Plain http redirects to https', async () => {
  if (!IS_HTTPS) return { skip: 'not an https address' };
  try {
    const res = await fetch(`http://${HOST}/health`, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    ensure([301, 302, 307, 308].includes(res.status) && (res.headers.get('location') ?? '').startsWith('https://'), `answered ${res.status} instead of a redirect to https`);
  } catch (err) {
    if (err instanceof Failure) throw err;
    return { warn: `port 80 did not answer (${err.cause?.code ?? err.message}); fine behind Cloudflare, but Let's Encrypt renewals need it` };
  }
});

// ===== Anonymous visitors ======================================================
await check('Login-page endpoints are public (problems count, top score, zones)', async () => {
  const problems = await api('GET', '/problems?limit=1');
  ensure(problems.status === 200 && problems.body?.total > 0, `GET /problems?limit=1 answered ${problems.status}, total ${problems.body?.total}; was the database seeded (npm run seed)?`);
  const board = await api('GET', '/leaderboard/college?limit=1');
  ensure(board.status === 200 && Array.isArray(board.body), `GET /leaderboard/college?limit=1 answered ${board.status}`);
  const zones = await api('GET', '/territories');
  ensure(zones.status === 200 && Array.isArray(zones.body) && zones.body.length > 0, `GET /territories answered ${zones.status}`);
  ensure(leakedKeys([problems.body, board.body, zones.body]).length === 0, 'a public response carries a private field');
  state.problemId = problems.body.items[0].id;
  return `${problems.body.total} problems, ${zones.body.length} zones`;
});

await check('Everything else refuses a visitor without a token (401)', async () => {
  const paths = ['/problems?limit=20', '/problems/1', '/territories/grid', '/territories/owners', '/auth/me', '/leaderboard/college?limit=20', '/leaderboard/me/rank', '/contests/active', '/submissions/me/status'];
  const wrong = [];
  for (const path of paths) {
    const res = await api('GET', path);
    if (res.status !== 401) wrong.push(`${path} -> ${res.status}`);
  }
  ensure(wrong.length === 0, `not refused: ${wrong.join(', ')}`);
  return `${paths.length} routes`;
});

await check('Password sign-up and sign-in are off', async () => {
  const signup = await api('POST', '/auth/signup', { json: { email: 'nobody@thapar.edu', password: 'not-a-real-password-1' } });
  ensure(signup.status === 410, `POST /auth/signup answered ${signup.status} (expected 410)`);
  const login = await api('POST', '/auth/login', { json: { email: 'nobody@thapar.edu', password: 'not-a-real-password-1' } });
  ensure(login.status === 403, `POST /auth/login answered ${login.status} (expected 403; is PASSWORD_LOGIN_ENABLED unset?)`);
});

// ===== Demo (guest) session ====================================================
await check('Demo session: POST /auth/guest issues a 2-hour guest token', async () => {
  const res = await api('POST', '/auth/guest');
  ensure(res.status === 200 && typeof res.body?.accessToken === 'string', `answered ${res.status} ${res.text.slice(0, 100)}`);
  ensure(res.body.role === 'GUEST' && res.body.expiresIn === 7200, `role ${res.body.role}, expiresIn ${res.body.expiresIn} (expected GUEST / 7200)`);
  const parts = res.body.accessToken.split('.');
  ensure(parts.length === 3, 'the token is not a JWT');
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  ensure(String(claims.sub).startsWith('guest:') && !('email' in claims), 'the token has an unexpected shape');
  state.token = res.body.accessToken;
  return `claims: ${Object.keys(claims).sort().join(', ')}`;
});

await check('The guest is told it is a guest (GET /auth/me), without an email', async () => {
  const skip = needsGuest();
  if (skip) return skip;
  const res = await api('GET', '/auth/me', { token: state.token });
  ensure(res.status === 200 && res.body?.isGuest === true && res.body?.role === 'GUEST', `answered ${res.status} ${res.text.slice(0, 120)}`);
  ensure(leakedKeys(res.body).length === 0, 'it carries a private field');
});

await check('Map: 1000 cells on grid version 2', async () => {
  const skip = needsGuest();
  if (skip) return skip;
  const res = await api('GET', '/territories/grid', { token: state.token, headers: { 'accept-encoding': 'gzip' } });
  ensure(res.status === 200, `answered ${res.status}`);
  const { gridVersion, zones, cells } = res.body ?? {};
  ensure(Array.isArray(cells) && cells.length === 1000 && gridVersion === 2, `${cells?.length} cells on grid version ${gridVersion}; run the regrid (RUNBOOK, step "Regrid")`);
  ensure(
    Array.isArray(zones) && zones.length > 0 && cells.every((c) => Array.isArray(c) && c.length === 4 && typeof c[0] === 'string' && c.slice(1).every(Number.isInteger)),
    'the cell list has an unexpected shape (expected [id, zone, row, col] rows)',
  );
  const encoding = res.headers.get('content-encoding');
  return encoding ? `${zones.length} zones, compressed with ${encoding}` : { warn: 'the grid is sent uncompressed (about 100 KB instead of 25 KB); check gzip in Nginx / Cloudflare' };
});

await check('Map: who holds what, by username only, nothing "mine" for a guest', async () => {
  const skip = needsGuest();
  if (skip) return skip;
  const grid = await api('GET', '/territories/grid', { token: state.token });
  const res = await api('GET', '/territories/owners', { token: state.token });
  ensure(res.status === 200, `answered ${res.status}`);
  const { gridVersion, owners, held } = res.body ?? {};
  ensure(gridVersion === grid.body?.gridVersion && Array.isArray(owners) && Array.isArray(held), 'unexpected shape');
  ensure(owners.every((o) => exactKeys(o, ['username', 'color', 'isMe']) && o.isMe === false && !String(o.username).includes('@')), 'an owner entry has extra fields, an "@", or isMe true for a guest');
  ensure(held.every((pair) => Array.isArray(pair) && pair[0] >= 0 && pair[0] < 1000 && pair[1] >= 0 && pair[1] < owners.length), 'a held entry points outside the grid or the owner list');
  return `${held.length} cells held by ${owners.length} players`;
});

await check('Leaderboard rows are exactly { username, score, isMe, color }', async () => {
  const skip = needsGuest();
  if (skip) return skip;
  const res = await api('GET', '/leaderboard/college?limit=50', { token: state.token });
  ensure(res.status === 200 && Array.isArray(res.body), `answered ${res.status}`);
  ensure(res.body.every((row) => exactKeys(row, ['username', 'score', 'isMe', 'color']) && !String(row.username).includes('@')), 'a row has extra fields or an email address as its name');
  return `${res.body.length} rows`;
});

await check('Problems: no hidden test cases, no private fields', async () => {
  const skip = needsGuest();
  if (skip) return skip;
  ensure(state.problemId, 'no problem id (the public problems check failed)');
  const list = await api('GET', '/problems?limit=20', { token: state.token });
  const one = await api('GET', `/problems/${state.problemId}`, { token: state.token });
  ensure(list.status === 200 && one.status === 200, `list ${list.status}, detail ${one.status}`);
  const leaks = leakedKeys([list.body, one.body]);
  ensure(leaks.length === 0, `fields that must stay on the server: ${leaks.join(', ')}`);
  state.starterCode = one.body?.boilerplate;
});

await check('A guest cannot write: submit, challenge, change settings (403)', async () => {
  const skip = needsGuest();
  if (skip) return skip;
  const attempts = [
    ['POST', '/submissions', {}],
    ['POST', '/contests/challenges', {}],
    ['PATCH', '/auth/settings', { flavorTextEnabled: true }],
  ];
  const wrong = [];
  for (const [method, path, json] of attempts) {
    const res = await api(method, path, { token: state.token, json });
    if (res.status !== 403) wrong.push(`${method} ${path} -> ${res.status}`);
  }
  ensure(wrong.length === 0, `not refused with 403: ${wrong.join(', ')}`);
});

// The program sent is the problem's own starter code: it builds and runs but does not solve
// anything, so a wrong-answer verdict is the expected, healthy result.
for (const language of ['python', 'c++']) {
  await check(`Run on the published examples (${language}) works through Piston`, async () => {
    const skip = needsGuest();
    if (skip) return skip;
    if (SKIP_RUN) return { skip: '--skip-run' };
    const code = state.starterCode?.[language];
    ensure(state.problemId && code, `no starter code for ${language} (the problems check failed)`);
    const res = await api('POST', '/run', { token: state.token, json: { problemId: state.problemId, language, code } });
    ensure(res.status !== 503, `the code runner is unavailable: docker ps (piston-api Up?), curl http://127.0.0.1:2000/api/v2/runtimes on the server (is ${language === 'python' ? 'python 3.10.0' : 'gcc 10.2.0'} installed?), and PISTON_URL in the env file`);
    ensure(res.status === 200 && Array.isArray(res.body?.results) && res.body.results.length > 0, `answered ${res.status} ${res.text.slice(0, 120)}`);
    ensure(res.body.results.every((r) => r.status !== 'CE'), `the starter code did not build: ${String(res.body.results[0]?.error ?? '').slice(0, 160)}`);
    ensure(leakedKeys(res.body).length === 0, 'the run result carries a private field');
    return `verdict ${res.body.verdict} (${res.body.passed}/${res.body.total} examples; the starter code is not expected to pass)`;
  });
}

// ===== Forged and tampered tokens ==============================================
await check('Forged, unsigned and tampered tokens are rejected (401)', async () => {
  const candidates = [];
  for (const secret of OLD_SECRETS) {
    candidates.push([`guest token signed with the old default secret`, forge({ secret, claims: { sub: 'guest:forged', role: 'GUEST' } })]);
    candidates.push([`student token signed with the old default secret`, forge({ secret, claims: { sub: '00000000-0000-4000-8000-000000000000', role: 'USER' } })]);
    candidates.push([`HS384 token signed with the old default secret`, forge({ secret, alg: 'HS384', claims: { sub: 'guest:forged', role: 'GUEST' } })]);
  }
  candidates.push(['unsigned token (alg none)', forge({ secret: null, alg: 'none', claims: { sub: 'guest:forged', role: 'GUEST' } })]);
  candidates.push(['not a token at all', 'not.a.jwt']);
  if (state.token) {
    const [header, payload, signature] = state.token.split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    candidates.push(['real guest token with the role changed to USER', `${header}.${b64url(JSON.stringify({ ...claims, role: 'USER' }))}.${signature}`]);
  }
  const accepted = [];
  for (const [label, token] of candidates) {
    const res = await api('GET', '/auth/me', { token });
    if (res.status !== 401) accepted.push(`${label} -> ${res.status}`);
  }
  ensure(accepted.length === 0, `NOT rejected: ${accepted.join('; ')}`);
  return `${candidates.length} forgeries rejected`;
});

// ===== Headers, CORS, errors ===================================================
await check('Security headers (HSTS, CSP, nosniff) and no version banners', async () => {
  const res = await api('GET', '/health');
  const h = res.headers;
  const missing = [];
  if (IS_HTTPS) {
    const hsts = /max-age=(\d+)/.exec(h.get('strict-transport-security') ?? '');
    if (!hsts || Number(hsts[1]) < 15_552_000) missing.push('Strict-Transport-Security (max-age of at least 180 days)');
  }
  if (!(h.get('content-security-policy') ?? '').includes("default-src 'none'")) missing.push("Content-Security-Policy default-src 'none'");
  if (h.get('x-content-type-options') !== 'nosniff') missing.push('X-Content-Type-Options: nosniff');
  ensure(missing.length === 0, `missing: ${missing.join('; ')}`);
  ensure(!h.get('x-powered-by'), `X-Powered-By is sent (${h.get('x-powered-by')})`);
  ensure(!/\d/.test(h.get('server') ?? ''), `the Server header gives a version (${h.get('server')}); set server_tokens off in Nginx`);
});

await check('CORS: a stranger\'s site is not allowed, the frontend is', async () => {
  const preflight = (origin) =>
    api('OPTIONS', '/auth/guest', { headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' } });
  const stranger = await preflight(STRANGER);
  const allowed = stranger.headers.get('access-control-allow-origin');
  ensure(allowed !== STRANGER && allowed !== '*', `a stranger's origin gets Access-Control-Allow-Origin: ${allowed}`);
  const simple = await api('GET', '/health', { headers: { origin: STRANGER } });
  ensure(simple.headers.get('access-control-allow-origin') !== STRANGER && simple.headers.get('access-control-allow-origin') !== '*', "a stranger's GET gets an Allow-Origin header");
  if (!FRONTEND) return { warn: 'no --frontend given, so the frontend origin was not checked' };
  const own = await preflight(FRONTEND);
  ensure(own.headers.get('access-control-allow-origin') === FRONTEND, `the frontend ${FRONTEND} is not allowed (got ${own.headers.get('access-control-allow-origin')}); check FRONTEND_URL / CORS_ORIGINS in the env file, then pm2 restart`);
  ensure(/authorization/i.test(own.headers.get('access-control-allow-headers') ?? ''), 'the Authorization header is not allowed for the frontend');
});

await check('Errors are generic: no stack traces or file paths', async () => {
  const responses = [await api('GET', '/does-not-exist'), await api('GET', '/problems/abc', { token: state.token }), await api('POST', '/auth/exchange', { json: { code: 'x' } })];
  for (const res of responses) {
    ensure(!/node_modules|\/home\/|\.ts:\d+|\s+at\s+\S+\s+\(/.test(res.text), `a ${res.status} response shows internals: ${res.text.slice(0, 120)}`);
  }
});

// ===== Sign-in and real time ===================================================
await check('Google sign-in starts with the right client, redirect URI, domain hint and state', async () => {
  const res = await api('GET', '/auth/google');
  ensure(res.status === 302, `answered ${res.status} (expected a redirect to Google; are GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET set?)`);
  const target = new URL(res.headers.get('location'));
  ensure(target.hostname === 'accounts.google.com', `redirects to ${target.hostname}`);
  ensure(target.searchParams.get('client_id'), 'no client_id');
  ensure(target.searchParams.get('state'), 'no state parameter (login CSRF protection)');
  ensure(target.searchParams.get('hd') === 'thapar.edu', `hd is ${target.searchParams.get('hd')} (expected thapar.edu)`);
  const cookie = res.headers.get('set-cookie') ?? '';
  ensure(/cc_oauth_state=/.test(cookie) && /httponly/i.test(cookie), 'the state cookie is missing or not HttpOnly');
  ensure(!IS_HTTPS || /;\s*secure/i.test(cookie), 'the state cookie is not Secure');
  const redirectUri = target.searchParams.get('redirect_uri');
  const expected = `${BASE}/auth/google/callback`;
  if (redirectUri !== expected) {
    const message = `redirect_uri is ${redirectUri}, this address would give ${expected}. GOOGLE_CALLBACK_URL and the "Authorized redirect URIs" in Google Cloud Console must be the same string`;
    if (IS_HTTPS) throw new Failure(message);
    return { warn: message };
  }
  return `redirect_uri ${redirectUri} (must also be listed in Google Cloud Console)`;
});

await check('Socket.IO reaches the backend through Nginx (polling handshake)', async () => {
  const res = await api('GET', '/socket.io/?EIO=4&transport=polling');
  ensure(res.status === 200 && /^0\{.*"sid"/.test(res.text), `answered ${res.status} ${res.text.slice(0, 80)}; check the /socket.io/ location in Nginx`);
  const stranger = await api('GET', '/socket.io/?EIO=4&transport=polling', { headers: { origin: STRANGER } });
  const allowed = stranger.headers.get('access-control-allow-origin');
  ensure(allowed !== STRANGER && allowed !== '*', `Socket.IO allows a stranger's origin (${allowed})`);
});

// ===== From outside the box ====================================================
await check('Ports 3000 (backend) and 2000 (Piston) are closed to the internet', async () => {
  if (!ORIGIN_IP) return { skip: 'give --origin-ip <the EC2 public IP> to check' };
  const open = [];
  for (const port of [3000, 2000]) if (await tcpOpen(ORIGIN_IP, port)) open.push(port);
  ensure(open.length === 0, `reachable from outside: ${open.join(', ')}. The backend must listen on 127.0.0.1 (HOST) and Piston must be published as 127.0.0.1:2000`);
});

// ----- summary ----------------------------------------------------------------
console.log(`\n${tally.PASS} passed, ${tally.WARN} warnings, ${tally.SKIP} skipped, ${tally.FAIL} failed`);
process.exit(tally.FAIL > 0 ? 1 : 0);
