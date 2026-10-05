// =============================================================================
// Piston escape tests: assertion and classification logic.
//
// Everything in this file is a pure function or a constant: no network, no
// files, no clock. That is what lets selftest.mjs feed it hand-made and mocked
// responses and check that it says PASS and FAIL for the right reasons.
// run.mjs does the I/O; programs.mjs holds the attack programs.
//
// -----------------------------------------------------------------------------
// THRESHOLDS: every number that can turn a PASS into a FAIL (strict, not flaky)
// -----------------------------------------------------------------------------
//  T1 Wall clock (infinite loop, fork bomb, memory bomb). The HTTP response must
//     arrive within  run timeout + 5 s  (plus the compile timeout for C++, whose
//     response includes the compile step). 5 s covers the HTTP round trip,
//     process start-up and Piston's clean-up of leftover processes, and is far
//     below the "never ends" this guards against. If the response reports its
//     own wall_time, that must stay within run timeout + 5 s as well.
//  T2 API recovery. After each attack, GET /api/v2/runtimes must answer 200 with
//     a JSON array within 10 s (polled every 250 ms). A fork bomb or memory
//     bomb that merely slows Piston down for a moment passes; one that takes
//     the API down does not.
//  T3 Response size (huge stdout, huge stderr). The HTTP body must stay under
//     4 x OUTPUT_MAX_SIZE + 32 KiB (288 KiB with the production 64 KiB). Why not
//     a flat 256 KiB: Piston appends the chunk that crosses the limit before it
//     notices, and a fast writer fills a whole 64 KiB pipe chunk, so a stream can
//     reach 2 x OUTPUT_MAX_SIZE; the response then carries it twice (`stdout`
//     and `output`), which is about 262 KB for a correctly configured 64 KiB
//     limit. A flat 256 KiB bound would fail a healthy Piston now and then.
//     A runaway 100 MB output still fails by a factor of ~350.
//  T4 Network: a TCP probe counts as blocked in exactly two cases, and neither
//     depends on what happens to be listening at the target:
//       - socket() itself is refused (EACCES, EPERM, ...) or the job is killed by
//         SIGSYS: a seccomp filter on socket(), which is how older Piston
//         releases disable networking;
//       - socket() works but connect() fails at once with ENETUNREACH (errno 101,
//         "Network is unreachable"): the job sits in an empty network namespace
//         with no interface and no route, which is what current Piston does
//         with PISTON_DISABLE_NETWORKING=true.
//     Any other connect() failure (refused, timed out, host unreachable) is a
//     FAIL: it proves a route exists, so networking is on. DNS and HTTP must
//     fail as well.
//  T5 Environment: no key starting with CANARY_ or PISTON_ (except
//     PISTON_LANGUAGE, which Piston itself sets for its compile and run
//     scripts), no key that looks like a secret, and no canary or secret-shaped
//     value anywhere in any response.
//  T6 Files: every read, list, stat and write probe must be BLOCKED, with two
//     deliberate exceptions: listing /home may succeed if it is empty (a
//     default, empty directory), and the two control probes (reading
//     /etc/passwd, writing into the job's own directory) MUST succeed, which
//     proves the probe code works and a green result is not just a broken probe.
//     Two probes look at /proc instead of one path. PID 1's root directory must
//     not be a different directory than the job's own root (inside a PID
//     namespace PID 1 can be the sandbox's own init, which is harmless). And no
//     readable /proc/<pid>/environ may hold a PISTON_ or CANARY_ variable other
//     than PISTON_LANGUAGE: PID 1 of the container is the Piston server, whose
//     environment is all of limits.env.
//  T7 Memory bomb: must end as RE or SG (killed or errored). A timeout does not
//     count: it means the memory limit did not stop the program.
//  T8 Probe lines missing from the output count as FAIL, never as PASS: an
//     attack that was not demonstrably blocked is not contained.
// =============================================================================

export const KIB = 1024;
export const MIB = 1024 * 1024;

export const THRESHOLDS = Object.freeze({
  wallSlackMs: 5000, // T1
  apiRecoveryMs: 10_000, // T2
  apiPollIntervalMs: 250,
  apiProbeTimeoutMs: 2000,
  responseSlackBytes: 32 * KIB, // T3
  responseReadCapBytes: 8 * MIB, // the client stops reading here and calls it a FAIL
});

/** The only PISTON_ variable a job may see: Piston's own compile/run scripts read it. */
export const ALLOWED_PISTON_ENV_KEYS = Object.freeze(['PISTON_LANGUAGE']);

/** Names that look like credentials. Deliberately broad: a sandbox has no business holding any of them. */
export const SECRET_KEY_PATTERN =
  /(SECRET|TOKEN|PASSW(OR)?D|PASSPHRASE|PRIVATE|CREDENTIAL|API[_-]?KEY|ACCESS[_-]?KEY|AUTH|COOKIE|SESSION|DATABASE_URL|REDIS_URL|JWT|AWS_|GOOGLE_|SUPABASE)/i;

export const CANARY_PREFIX = 'CC-CANARY-';
export const HELLO_MARKER = 'CC-HELLO-OK';
export const OUTPUT_SURVIVED_MARKER = 'CC-OUTPUT-SURVIVED';
export const MEMORY_SURVIVED_MARKER = 'CC-MEM-SURVIVED';

/** Piston language/version per harness language key, and whether the response includes a compile step. */
export const LANGS = Object.freeze({
  python: { label: 'python', language: 'python', version: '3.10.0', file: 'main.py', compiled: false },
  cpp: { label: 'c++', language: 'c++', version: '10.2.0', file: 'main.cpp', compiled: true },
});

export const SCENARIOS = Object.freeze([
  'sanity',
  'infinite-loop',
  'fork-bomb',
  'huge-output',
  'huge-stderr',
  'file-access',
  'env-leak',
  'network',
  'memory-bomb',
  'limit-raise',
]);

// -----------------------------------------------------------------------------
// limits.env
// -----------------------------------------------------------------------------

/** What deploy/piston/limits.env says. selftest.mjs fails if the two ever differ. */
export const DEFAULT_ENV = Object.freeze({
  PISTON_DISABLE_NETWORKING: 'true',
  PISTON_RUN_TIMEOUT: '3000',
  PISTON_COMPILE_TIMEOUT: '10000',
  PISTON_RUN_CPU_TIME: '3000',
  PISTON_COMPILE_CPU_TIME: '10000',
  PISTON_RUN_MEMORY_LIMIT: '134217728',
  PISTON_COMPILE_MEMORY_LIMIT: '402653184',
  PISTON_OUTPUT_MAX_SIZE: '65536',
  PISTON_MAX_PROCESS_COUNT: '64',
  PISTON_MAX_OPEN_FILES: '256',
  PISTON_MAX_FILE_SIZE: '5242880',
  PISTON_MAX_CONCURRENT_JOBS: '2',
  PISTON_LOG_LEVEL: 'INFO',
});

/** Parses a docker --env-file: KEY=VALUE lines, "#" comment lines, blank lines; no quote handling (like docker). */
export function parseEnvFile(text) {
  const env = {};
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.trim() === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    env[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return env;
}

/** Problems that would make `docker run --env-file` store something other than what was meant. */
export function validateEnvFileText(text) {
  const problems = [];
  if (String(text).includes('\r')) problems.push('contains CR characters (Windows line endings)');
  String(text)
    .split('\n')
    .forEach((line, i) => {
      if (line.trim() === '' || line.startsWith('#')) return;
      if (!/^PISTON_[A-Z0-9_]+=[^\s"'#]*$/.test(line)) {
        problems.push(`line ${i + 1} is not a plain PISTON_KEY=VALUE line (no quotes, spaces or trailing comments): ${line}`);
      }
    });
  return problems;
}

const intOr = (value, fallback) => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
};

/** Turns env-file values into the numbers the checks use. */
export function limitsFromEnv(env = {}) {
  const d = DEFAULT_ENV;
  const get = (key) => env[key] ?? d[key];
  return {
    disableNetworking: String(get('PISTON_DISABLE_NETWORKING')).toLowerCase() === 'true',
    runTimeoutMs: intOr(get('PISTON_RUN_TIMEOUT'), 3000),
    compileTimeoutMs: intOr(get('PISTON_COMPILE_TIMEOUT'), 10_000),
    runCpuTimeMs: intOr(get('PISTON_RUN_CPU_TIME'), 3000),
    compileCpuTimeMs: intOr(get('PISTON_COMPILE_CPU_TIME'), 10_000),
    runMemoryBytes: intOr(get('PISTON_RUN_MEMORY_LIMIT'), 134_217_728),
    compileMemoryBytes: intOr(get('PISTON_COMPILE_MEMORY_LIMIT'), 402_653_184),
    outputMaxBytes: intOr(get('PISTON_OUTPUT_MAX_SIZE'), 65_536),
    maxProcesses: intOr(get('PISTON_MAX_PROCESS_COUNT'), 64),
    maxOpenFiles: intOr(get('PISTON_MAX_OPEN_FILES'), 256),
    maxFileBytes: intOr(get('PISTON_MAX_FILE_SIZE'), 5_242_880),
    maxConcurrentJobs: intOr(get('PISTON_MAX_CONCURRENT_JOBS'), 2),
  };
}

export const DEFAULT_LIMITS = Object.freeze(limitsFromEnv(DEFAULT_ENV));

/** T1: how long the HTTP response for one job may take. */
export function budgetMs(lang, limits, thresholds) {
  const compile = LANGS[lang]?.compiled ? limits.compileTimeoutMs : 0;
  return compile + limits.runTimeoutMs + thresholds.wallSlackMs;
}

/** T3: the largest acceptable response body for the huge-output scenario. */
export function maxResponseBytes(limits, thresholds) {
  return 4 * limits.outputMaxBytes + thresholds.responseSlackBytes;
}

// -----------------------------------------------------------------------------
// Reading a Piston stage ({stdout, stderr, output, code, signal, message, status})
// -----------------------------------------------------------------------------

const STATUS_KIND = Object.freeze({
  TO: 'timeout',
  SG: 'signal',
  RE: 'runtime_error',
  OL: 'output_limit',
  EL: 'stderr_limit',
  XX: 'internal',
});

/**
 * Uses Piston's two-letter `status` when present, otherwise derives the same
 * thing from `signal` and `code` (older Piston versions have no `status`).
 * `killed` = Piston or the kernel ended it by force (timeout, signal, output cap).
 */
export function classifyStage(stage) {
  if (!stage || typeof stage !== 'object') {
    return { kind: 'missing', status: null, signal: null, code: null, killed: false, signalExit: false, failed: true };
  }
  const status = typeof stage.status === 'string' && stage.status ? stage.status.toUpperCase() : null;
  const signal = stage.signal ?? null;
  const code = typeof stage.code === 'number' ? stage.code : null;
  let kind = status ? STATUS_KIND[status] : undefined;
  if (!kind) {
    if (signal) kind = 'signal';
    else if (code !== null && code !== 0) kind = 'runtime_error';
    else if (code === 0) kind = 'ok';
    else kind = 'unknown';
  }
  // Jobs run behind shell wrappers, so a process that the kernel killed (SIGXCPU,
  // SIGKILL, ...) can surface as exit code 128+N with no `signal` at all.
  const signalExit = kind === 'runtime_error' && code !== null && code >= 129 && code <= 159;
  const killed = kind === 'timeout' || kind === 'signal' || kind === 'output_limit' || kind === 'stderr_limit' || signalExit;
  return { kind, status, signal, code, killed, signalExit, failed: kind !== 'ok' };
}

export function describeStage(stage) {
  if (!stage || typeof stage !== 'object') return 'no stage';
  const c = classifyStage(stage);
  return `status=${c.status ?? '-'} signal=${c.signal ?? '-'} code=${c.code ?? '-'}`;
}

const snippet = (value, n = 110) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, n);

// -----------------------------------------------------------------------------
// Parsing what the attack programs print
// -----------------------------------------------------------------------------

/** "CCPROBE<TAB>id<TAB>VERDICT<TAB>detail" lines -> Map(id -> {verdict, detail}). ALLOWED wins a duplicate id. */
export function parseProbeLines(text) {
  const probes = new Map();
  for (const line of String(text ?? '').split('\n')) {
    if (!line.startsWith('CCPROBE\t')) continue;
    const [, id, verdict, ...rest] = line.split('\t');
    if (!id || !verdict) continue;
    const entry = { verdict: verdict.trim(), detail: rest.join('\t').trim() };
    const previous = probes.get(id);
    if (!previous || (entry.verdict !== 'BLOCKED' && previous.verdict === 'BLOCKED')) probes.set(id, entry);
  }
  return probes;
}

/** "CCENV<TAB>KEY<TAB>value" lines -> [{key, value}]. */
export function parseEnvDump(text) {
  const out = [];
  for (const line of String(text ?? '').split('\n')) {
    if (!line.startsWith('CCENV\t')) continue;
    const [, key, ...rest] = line.split('\t');
    if (key) out.push({ key, value: rest.join('\t') });
  }
  return out;
}

/**
 * Looks for things that must never appear in a response: the canary, password
 * hashes, private keys, cloud credentials, tokens. Returns short labels, never
 * the secret itself, so a FAIL line cannot repeat a secret into a log.
 */
export function findLeaks(text, { canaryToken } = {}) {
  const body = String(text ?? '');
  const found = new Set();
  if (canaryToken && body.includes(canaryToken)) found.add('canary token');
  if (new RegExp(`${CANARY_PREFIX}[0-9a-f]{12,}`).test(body)) found.add('canary-shaped token');
  if (/^[a-z_][a-z0-9_.-]*:(\$[0-9a-z]+\$[^:\s]+|\*|!+[^:\s]*):\d*:/m.test(body)) found.add('password-hash line (/etc/shadow style)');
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(body)) found.add('private key');
  if (/\bAKIA[0-9A-Z]{16}\b/.test(body)) found.add('AWS access key id');
  if (/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/.test(body)) found.add('JWT-shaped token');
  return [...found];
}

// -----------------------------------------------------------------------------
// What the file-access and network programs probe (shared by both languages,
// by programs.mjs and by the mock, so they cannot drift apart)
// -----------------------------------------------------------------------------

export const FS_TARGETS = Object.freeze({
  // Opening any of these must fail. /dev/* matter because the container is
  // --privileged: the host's disks are visible there and only file permissions
  // keep a job out. The home-directory files normally do not exist at all.
  // (/proc/1/environ is not here: see `foreignRoot` and the environ scan below.)
  read: Object.freeze([
    '/etc/shadow',
    '/etc/gshadow',
    '/root/.bash_history',
    '/root/.ssh/id_rsa',
    '/root/.aws/credentials',
    '/root/.docker/config.json',
    '/dev/mem',
    '/dev/nvme0n1',
    '/dev/nvme0n1p1',
    '/dev/xvda',
    '/dev/xvda1',
    '/dev/sda',
    '/dev/sda1',
  ]),
  // A Docker socket in the sandbox would be a full host takeover, so even seeing it is a FAIL.
  stat: Object.freeze(['/var/run/docker.sock', '/run/docker.sock']),
  list: Object.freeze([
    Object.freeze({ path: '/root', allowEmpty: false }),
    Object.freeze({ path: '/home', allowEmpty: true }),
  ]),
  // The root directory of PID 1. BLOCKED means it cannot be opened, or it is the
  // very same directory as the job's own "/" (the sandbox's own init). ALLOWED
  // means the job can walk into a different root, for example the Piston
  // container's, through /proc/1/root.
  foreignRoot: '/proc/1/root',
  // Creating a file here must fail. The two package directories matter most: a
  // job that could write into the interpreter or compiler it is running with
  // could poison it for every later job. (/piston_api is where the image keeps
  // the Piston server's code; /piston/api is the same idea under the old name.
  // Directories that do not exist inside the sandbox count as blocked.)
  write: Object.freeze([
    '/etc',
    '/usr',
    '/piston_api',
    '/piston/api',
    '/piston/packages',
    '/piston/packages/python/3.10.0',
    '/piston/packages/gcc/10.2.0',
    '/',
  ]),
  controlRead: '/etc/passwd',
});

/** Programs and the mock embed these paths in source code, so keep them boring. */
export function validateCanaryPaths(paths) {
  for (const p of paths) {
    if (!/^\/[A-Za-z0-9_.@+\-/]+$/.test(p)) throw new Error(`canary path has unsupported characters: ${p}`);
  }
  return paths;
}

/**
 * One entry per probe the file-access program prints. Python and C++ run the
 * same probes (`lang` is accepted for the callers, it changes nothing).
 * expect: 'BLOCKED' | 'BLOCKED_OR_EMPTY' (a listing that succeeds is fine only if empty) | 'ALLOWED' (control).
 */
export function fsProbePlan(lang, canaryPaths = []) {
  void lang;
  const plan = [];
  for (const path of FS_TARGETS.read) plan.push({ id: `read:${path}`, expect: 'BLOCKED' });
  for (const path of canaryPaths) plan.push({ id: `read:${path}`, expect: 'BLOCKED', canary: true });
  for (const path of FS_TARGETS.stat) plan.push({ id: `stat:${path}`, expect: 'BLOCKED' });
  for (const { path, allowEmpty } of FS_TARGETS.list) {
    plan.push({ id: `list:${path}`, expect: allowEmpty ? 'BLOCKED_OR_EMPTY' : 'BLOCKED' });
  }
  plan.push({ id: `root:${FS_TARGETS.foreignRoot}`, expect: 'BLOCKED' });
  for (const path of FS_TARGETS.write) plan.push({ id: `write:${path}`, expect: 'BLOCKED' });
  plan.push({ id: 'scan:/proc/*/environ', expect: 'BLOCKED' });
  plan.push({ id: `control:read:${FS_TARGETS.controlRead}`, expect: 'ALLOWED' });
  plan.push({ id: 'control:write:cwd', expect: 'ALLOWED' });
  return plan;
}

export const NET_TARGETS = Object.freeze({
  tcp: Object.freeze([
    Object.freeze({ host: '1.1.1.1', port: 443, why: 'public internet' }),
    Object.freeze({ host: '172.17.0.1', port: 3000, why: 'Docker bridge gateway = the host, backend port' }),
    Object.freeze({ host: '172.17.0.1', port: 22, why: 'Docker bridge gateway = the host, sshd' }),
    Object.freeze({ host: '127.0.0.1', port: 2000, why: "Piston's own API on loopback" }),
  ]),
  dns: 'example.com',
  metadata: Object.freeze({ host: '169.254.169.254', port: 80, url: 'http://169.254.169.254/latest/meta-data/' }),
});

/** Python reaches the metadata service over HTTP (urllib), C++ over a raw TCP connect. */
export function netProbePlan(lang) {
  const plan = NET_TARGETS.tcp.map((t) => ({ id: `tcp:${t.host}:${t.port}`, kind: 'tcp', socketLevel: true }));
  plan.push(
    lang === 'python'
      ? { id: 'http:169.254.169.254', kind: 'http', socketLevel: false }
      : { id: 'tcp:169.254.169.254:80', kind: 'tcp', socketLevel: true },
  );
  plan.push({ id: `dns:${NET_TARGETS.dns}`, kind: 'dns', socketLevel: false });
  return plan;
}

// -----------------------------------------------------------------------------
// Evaluators: (HTTP result of the job, context) -> {ok, detail}
//   res   = {error?, httpStatus, elapsedMs, bytes, text, json, truncated}  (see run.mjs)
//   ctx   = {limits, thresholds, canaryToken, canaryPaths}
//   after = {alive, withinMs, last} result of the API liveness check after the attack
// -----------------------------------------------------------------------------

const pass = (detail) => ({ ok: true, detail });
const fail = (detail) => ({ ok: false, detail });

const MAX_LISTED = 4;
const summarizeProblems = (problems) =>
  problems.length <= MAX_LISTED
    ? problems.join('; ')
    : `${problems.slice(0, MAX_LISTED).join('; ')}; (+${problems.length - MAX_LISTED} more)`;

/** Common first steps: transport, HTTP status, JSON, compile step, run stage present. */
function inspectResponse(res, lang, ctx) {
  if (!res) return { problem: 'internal: no response object' };
  const budget = budgetMs(lang, ctx.limits, ctx.thresholds);
  if (res.error === 'deadline') return { problem: `no response within ${budget} ms (run timeout + slack): the job outlived its limits or Piston hung` };
  if (res.error) return { problem: `request failed: ${res.error}` };
  if (res.truncated) return { problem: `response body larger than ${ctx.thresholds.responseReadCapBytes} bytes (stopped reading)` };
  if (res.httpStatus !== 200) return { problem: `HTTP ${res.httpStatus}: ${snippet(res.text)}` };
  if (!res.json || typeof res.json !== 'object') return { problem: 'response is not JSON' };
  if (res.elapsedMs > budget) return { problem: `answered after ${Math.round(res.elapsedMs)} ms, over the ${budget} ms budget` };
  const { run, compile } = res.json;
  if (compile) {
    const c = classifyStage(compile);
    if (c.kind !== 'ok') {
      return { problem: `compile step failed (${describeStage(compile)}): ${snippet(compile.stderr || compile.output)}` };
    }
  }
  if (!run) return { problem: 'response has no run stage' };
  const wall = run.wall_time;
  if (typeof wall === 'number' && wall > ctx.limits.runTimeoutMs + ctx.thresholds.wallSlackMs) {
    return { problem: `run stage reports wall_time ${wall} ms, over run timeout + slack` };
  }
  return { json: res.json, run, compile };
}

function checkAfter(after) {
  if (!after) return 'internal: the API liveness check was not run';
  if (!after.alive) {
    return `API did not answer GET /api/v2/runtimes within ${after.withinMs} ms after the attack (${after.last ?? 'no answer'})`;
  }
  return null;
}

const ms = (res) => `${Math.round(res.elapsedMs)} ms`;

export function evalSanity({ res, lang, ctx }) {
  const r = inspectResponse(res, lang, ctx);
  if (r.problem) return fail(r.problem);
  const c = classifyStage(r.run);
  if (c.kind !== 'ok') return fail(`hello world did not run cleanly: ${describeStage(r.run)} ${snippet(r.run.stderr)}`);
  if (!String(r.run.stdout ?? '').includes(HELLO_MARKER)) return fail(`unexpected output: "${snippet(r.run.stdout)}"`);
  return pass(`hello world ran in ${ms(res)}${LANGS[lang].compiled ? ' (compile + run)' : ''}`);
}

export function evalInfiniteLoop({ res, lang, ctx, after }) {
  const r = inspectResponse(res, lang, ctx);
  if (r.problem) return fail(r.problem);
  const c = classifyStage(r.run);
  if (c.kind !== 'timeout' && c.kind !== 'signal' && !c.signalExit) {
    return fail(`loop was not stopped by a timeout or a signal (TO/SG expected): ${describeStage(r.run)}`);
  }
  const bad = checkAfter(after);
  if (bad) return fail(bad);
  return pass(`stopped with ${c.status ?? c.signal ?? `exit ${c.code}`} after ${ms(res)} (run timeout ${ctx.limits.runTimeoutMs} ms); API alive afterwards`);
}

export function evalForkBomb({ res, lang, ctx, after }) {
  const r = inspectResponse(res, lang, ctx);
  if (r.problem) return fail(r.problem);
  const c = classifyStage(r.run);
  if (!c.failed || c.kind === 'internal' || c.kind === 'unknown') {
    return fail(`fork bomb was not contained (clean exit or unknown state): ${describeStage(r.run)}`);
  }
  const bad = checkAfter(after);
  if (bad) return fail(bad);
  return pass(`contained: ${c.status ?? (c.signal ? 'SG' : 'RE')} after ${ms(res)}; API alive afterwards`);
}

/**
 * ~100 MB on one stream. The program prints OUTPUT_SURVIVED_MARKER on stdout
 * after the flood, so seeing it means nothing cut the output off. `stream` is
 * 'stdout' (Piston status OL) or 'stderr' (status EL); any kill counts.
 */
function evalOutputFlood(stream, { res, lang, ctx, after }) {
  const r = inspectResponse(res, lang, ctx);
  if (r.problem) return fail(r.problem);
  const c = classifyStage(r.run);
  const what = stream === 'stderr' ? 'stderr' : 'output';
  if (String(r.run.stdout ?? '').includes(OUTPUT_SURVIVED_MARKER)) {
    return fail(`the program ran to the end: ~100 MB of ${what} was not cut off`);
  }
  if (!c.killed) return fail(`${what} was not cut off by Piston (${stream === 'stderr' ? 'EL' : 'OL'} or a kill expected): ${describeStage(r.run)}`);
  const cap = maxResponseBytes(ctx.limits, ctx.thresholds);
  if (res.bytes >= cap) return fail(`response body is ${res.bytes} bytes, limit ${cap} (4 x OUTPUT_MAX_SIZE + slack)`);
  const bad = checkAfter(after);
  if (bad) return fail(bad);
  return pass(`${c.status ?? c.signal ?? `exit ${c.code}`}; response ${res.bytes} bytes (limit ${cap}); API alive afterwards`);
}

export const evalHugeOutput = (args) => evalOutputFlood('stdout', args);
export const evalHugeStderr = (args) => evalOutputFlood('stderr', args);

export function evalMemoryBomb({ res, lang, ctx, after }) {
  const r = inspectResponse(res, lang, ctx);
  if (r.problem) return fail(r.problem);
  const c = classifyStage(r.run);
  if (String(r.run.stdout ?? '').includes(MEMORY_SURVIVED_MARKER)) {
    return fail('the program allocated 2 GB and finished: the memory limit is not enforced');
  }
  if (c.kind === 'timeout') {
    return fail('timed out instead of being stopped by the memory limit (TO): PISTON_RUN_MEMORY_LIMIT is probably not applied');
  }
  if (c.kind !== 'runtime_error' && c.kind !== 'signal') {
    return fail(`allocation was not stopped (RE or SG expected): ${describeStage(r.run)}`);
  }
  const bad = checkAfter(after);
  if (bad) return fail(bad);
  return pass(`stopped with ${c.status ?? (c.signal ? 'SG' : 'RE')} after ${ms(res)}; API alive afterwards`);
}

export function evalFileAccess({ res, lang, ctx }) {
  const r = inspectResponse(res, lang, ctx);
  if (r.problem) return fail(r.problem);
  const stdout = String(r.run.stdout ?? '');
  const probes = parseProbeLines(stdout);
  const problems = [];
  const leaks = findLeaks(`${stdout}\n${r.run.stderr ?? ''}`, ctx);
  if (leaks.length > 0) problems.push(`LEAK in output: ${leaks.join(', ')}`);
  for (const step of fsProbePlan(lang, ctx.canaryPaths ?? [])) {
    const got = probes.get(step.id);
    if (!got) {
      problems.push(`${step.id}: no result reported (${describeStage(r.run)})`);
    } else if (step.expect === 'BLOCKED' && got.verdict !== 'BLOCKED') {
      problems.push(`${step.id}: ${got.verdict} (${snippet(got.detail, 60)})`);
    } else if (step.expect === 'BLOCKED_OR_EMPTY' && got.verdict !== 'BLOCKED' && !/entries=0\b/.test(got.detail)) {
      problems.push(`${step.id}: listing succeeded and is not empty (${snippet(got.detail, 60)})`);
    } else if (step.expect === 'ALLOWED' && got.verdict !== 'ALLOWED') {
      problems.push(`${step.id}: control probe failed, so the probe code cannot be trusted (${snippet(got.detail, 60)})`);
    }
  }
  if (problems.length > 0) return fail(summarizeProblems(problems));
  const count = fsProbePlan(lang, ctx.canaryPaths ?? []).length;
  return pass(`${count} probes: every read/list/stat/write blocked, controls OK, no canary content seen`);
}

export function evalEnvLeak({ res, lang, ctx }) {
  const r = inspectResponse(res, lang, ctx);
  if (r.problem) return fail(r.problem);
  const entries = parseEnvDump(r.run.stdout);
  if (entries.length === 0) return fail(`no environment dump in the output (${describeStage(r.run)})`);
  const problems = [];
  for (const { key, value } of entries) {
    if (key.startsWith('CANARY_')) problems.push(`${key} is visible to jobs`);
    else if (key.startsWith('PISTON_') && !ALLOWED_PISTON_ENV_KEYS.includes(key)) problems.push(`${key} is visible to jobs`);
    else if (SECRET_KEY_PATTERN.test(key)) problems.push(`${key} looks like a secret`);
    const valueLeaks = findLeaks(value, ctx);
    if (valueLeaks.length > 0) problems.push(`value of ${key} contains ${valueLeaks.join(', ')}`);
  }
  const stderrLeaks = findLeaks(r.run.stderr, ctx);
  if (stderrLeaks.length > 0) problems.push(`stderr contains ${stderrLeaks.join(', ')}`);
  if (problems.length > 0) return fail(summarizeProblems(problems));
  return pass(`${entries.length} variables (${entries.map((e) => e.key).join(', ')}), none sensitive`);
}

/** errno 101, ENETUNREACH: "Network is unreachable", what connect() says in a network namespace with no route. */
const NO_ROUTE = /\berrno=101\b/;

export function evalNetwork({ res, lang, ctx, after }) {
  const r = inspectResponse(res, lang, ctx);
  if (r.problem) return fail(r.problem);
  const c = classifyStage(r.run);
  const bad = checkAfter(after);
  if (bad) return fail(bad);
  if (c.signal === 'SIGSYS') {
    return pass('job was killed by SIGSYS at its first socket() call (seccomp): no socket can be created');
  }
  const probes = parseProbeLines(r.run.stdout);
  // Worst findings first, because the table cuts long details short.
  const reachable = [];
  const routed = [];
  const missing = [];
  let deniedAtSocket = 0;
  let noRoute = 0;
  for (const step of netProbePlan(lang)) {
    const got = probes.get(step.id);
    if (!got) {
      missing.push(`${step.id}: no result (${describeStage(r.run)}); a connect that hangs means a route exists`);
    } else if (got.verdict !== 'BLOCKED') {
      reachable.push(`NETWORK REACHABLE ${step.id}: ${snippet(got.detail, 70)}`);
    } else if (step.socketLevel) {
      if (/phase=socket\b/.test(got.detail)) deniedAtSocket++;
      else if (NO_ROUTE.test(got.detail)) noRoute++;
      else routed.push(`${step.id}: connect() failed for a reason other than "no route" (${snippet(got.detail, 60)}), so a route exists and networking is not disabled`);
    }
  }
  const problems = [...reachable, ...routed, ...missing];
  if (problems.length > 0) return fail(summarizeProblems(problems));
  const how = deniedAtSocket > 0 && noRoute > 0 ? 'socket() denied or ENETUNREACH' : deniedAtSocket > 0 ? 'socket() denied' : 'ENETUNREACH, no route';
  return pass(`${netProbePlan(lang).length} targets: every TCP connect impossible (${how}), DNS and HTTP failed`);
}

/**
 * attempts: [{field, value, res}], one request per limit field, each asking for
 * MORE than the configured cap. Piston must refuse each with HTTP 400.
 */
export function evalLimitRaise({ attempts }) {
  if (!attempts || attempts.length === 0) return fail('internal: no attempts were made');
  const problems = [];
  for (const { field, value, res } of attempts) {
    const label = `${field}=${value}`;
    if (res.error) problems.push(`${label}: request failed (${res.error})`);
    else if (res.httpStatus === 400 && /exceed|limit/i.test(res.text ?? '')) continue;
    else if (res.httpStatus === 200) problems.push(`${label}: ACCEPTED (HTTP 200): a request can raise the configured limit`);
    else problems.push(`${label}: HTTP ${res.httpStatus} ${snippet(res.text, 60)}`);
  }
  if (problems.length > 0) return fail(summarizeProblems(problems));
  return pass(`${attempts.length} oversized limits (${attempts.map((a) => a.field).join(', ')}) all refused with HTTP 400`);
}

export const EVALUATORS = Object.freeze({
  sanity: evalSanity,
  'infinite-loop': evalInfiniteLoop,
  'fork-bomb': evalForkBomb,
  'huge-output': evalHugeOutput,
  'huge-stderr': evalHugeStderr,
  'file-access': evalFileAccess,
  'env-leak': evalEnvLeak,
  network: evalNetwork,
  'memory-bomb': evalMemoryBomb,
  'limit-raise': evalLimitRaise,
});

// -----------------------------------------------------------------------------
// Output
// -----------------------------------------------------------------------------

/** Rows of {name, lang, ok, detail} -> an aligned PASS/FAIL table. */
export function formatTable(rows, { detailWidth = 118 } = {}) {
  const nameW = Math.max(8, ...rows.map((r) => r.name.length));
  const langW = Math.max(4, ...rows.map((r) => String(r.lang).length));
  const line = (a, b, c, d) => `${a.padEnd(nameW)}  ${b.padEnd(langW)}  ${c.padEnd(6)}  ${d}`;
  const out = [line('SCENARIO', 'LANG', 'RESULT', 'DETAIL'), line('-'.repeat(nameW), '-'.repeat(langW), '-'.repeat(6), '-'.repeat(20))];
  for (const r of rows) {
    const detail = r.detail.length > detailWidth ? `${r.detail.slice(0, detailWidth - 3)}...` : r.detail;
    out.push(line(r.name, String(r.lang), r.ok ? 'PASS' : 'FAIL', detail));
  }
  return out.join('\n');
}

export function summarize(rows) {
  const failed = rows.filter((r) => !r.ok);
  return { total: rows.length, passed: rows.length - failed.length, failed: failed.length, ok: failed.length === 0 && rows.length > 0 };
}
