#!/usr/bin/env node
// =============================================================================
// A tiny stand-in for the Piston HTTP API, used to test the test harness itself
// (selftest.mjs) without Docker. It implements only what the harness and the
// install scripts call:
//   GET  /api/v2/runtimes    POST /api/v2/execute
//   GET  /api/v2/packages    POST /api/v2/packages
// It does not run any code. It reads the `# CC:<scenario>` marker on the first
// line of the submitted program (see programs.mjs) and answers with canned
// responses in the shape real Piston uses: {language, version, run:{stdout,
// stderr, output, code, signal, message, status}, compile?}.
//
//   MODE=safe     what a correctly configured Piston answers: loops end TO or
//                 SG, the fork bomb RE or TO, huge output OL, file reads
//                 "permission denied", network "socket() denied", memory bomb
//                 killed, oversized limits refused with HTTP 400.
//   MODE=unsafe   every flaw in FLAWS at once: a loop that runs 60 s, an
//                 environment containing PISTON_RUN_MEMORY_LIMIT, a successful
//                 network connect, canary contents leaked, ... The harness
//                 must FAIL these. `FLAWS=env-leak,net-soft` switches on only
//                 the named flaws (for pinpointing one detection).
//
//   MODE=safe PORT=2999 node deploy/escape-tests/mock-piston.mjs
//   env: MODE, PORT (default 0 = random), FLAWS, NET_STYLE=errno|sigsys|netns
//        (how a correct Piston denies the network: socket() fails, the job is
//        killed by SIGSYS, or connect() says ENETUNREACH in an empty namespace),
//        LEGACY_SHAPE=1 (no `status` field), NO_PACKAGES=1 (nothing installed yet),
//        CANARY_TOKEN, CANARY_PATH (colon-separated), LIMITS_ENV_FILE
// =============================================================================
import http from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as lib from './lib.mjs';
import { scenarioOfSource } from './programs.mjs';

/**
 * name -> what is wrong, the scenario that must FAIL because of it, which
 * languages it affects, and whether MODE=unsafe includes it.
 */
export const FLAWS = Object.freeze({
  'loop-runs-long': { scenario: 'infinite-loop', what: 'a loop that is never stopped (runs 60 s)' },
  'fork-clean-exit': { scenario: 'fork-bomb', what: 'the fork bomb ends with a clean exit' },
  'api-dies-after-fork': { scenario: 'fork-bomb', what: 'the API stops answering after the fork bomb' },
  'output-unbounded': { scenario: 'huge-output', what: '3 MB of output is returned, no OL' },
  'stderr-unbounded': { scenario: 'huge-stderr', what: '3 MB of stderr is returned, no EL' },
  'file-read': { scenario: 'file-access', what: '/etc/shadow can be opened' },
  'canary-leak': { scenario: 'file-access', what: 'the canary file content is returned' },
  'root-listable': { scenario: 'file-access', what: '/root can be listed' },
  'home-nonempty': { scenario: 'file-access', what: '/home lists real entries' },
  'write-etc': { scenario: 'file-access', what: 'a file can be created in /etc' },
  'docker-sock': { scenario: 'file-access', what: '/var/run/docker.sock is visible' },
  'proc-environ': { scenario: 'file-access', what: "another process's environ is readable" },
  'proc-root': { scenario: 'file-access', what: "PID 1's root directory (a different one than the job's own) is reachable" },
  'probe-broken': { scenario: 'file-access', what: 'the control probes fail (a broken probe)', inUnsafe: false },
  'env-leak': { scenario: 'env-leak', what: 'PISTON_RUN_MEMORY_LIMIT and CANARY_ENV_SECRET are visible' },
  'env-secret': { scenario: 'env-leak', what: 'AWS_SECRET_ACCESS_KEY and DATABASE_URL are visible' },
  'env-value-leak': { scenario: 'env-leak', what: 'an innocent-looking variable holds the canary' },
  'net-connect': { scenario: 'network', what: 'a TCP connect to the Docker host succeeds' },
  'net-soft': { scenario: 'network', what: 'socket() works and only connect() fails' },
  'metadata-reachable': { scenario: 'network', what: 'the EC2 metadata service answers' },
  'dns-works': { scenario: 'network', what: 'DNS resolves' },
  'mem-survives': { scenario: 'memory-bomb', what: 'the 2 GB allocation succeeds' },
  'mem-timeout': { scenario: 'memory-bomb', what: 'the memory bomb ends as a timeout' },
  'limits-raisable': { scenario: 'limit-raise', what: 'a request may raise the configured limits' },
  'hello-broken': { scenario: 'sanity', what: 'hello world prints nothing', inUnsafe: false },
});

const UNSAFE_FLAWS = Object.entries(FLAWS)
  .filter(([, f]) => f.inUnsafe !== false)
  .map(([name]) => name);

const RUNTIMES = Object.freeze([
  { key: 'python@3.10.0', pkg: 'python@3.10.0', lang: 'python', info: { language: 'python', version: '3.10.0', aliases: ['py', 'py3', 'python3', 'python3.10'] } },
  { key: 'c++@10.2.0', pkg: 'gcc@10.2.0', lang: 'cpp', info: { language: 'c++', version: '10.2.0', aliases: ['cpp', 'g++'], runtime: 'gcc' } },
]);
const PACKAGES = Object.freeze([
  { language: 'python', language_version: '3.10.0', provides: ['python@3.10.0'] },
  { language: 'gcc', language_version: '10.2.0', provides: ['c++@10.2.0'] },
]);

const LIMIT_FIELDS = Object.freeze({
  run_timeout: 'runTimeoutMs',
  run_cpu_time: 'runCpuTimeMs',
  run_memory_limit: 'runMemoryBytes',
  compile_timeout: 'compileTimeoutMs',
  compile_cpu_time: 'compileCpuTimeMs',
  compile_memory_limit: 'compileMemoryBytes',
});

const stage = (o = {}) => ({
  stdout: o.stdout ?? '',
  stderr: o.stderr ?? '',
  output: `${o.stdout ?? ''}${o.stderr ?? ''}`,
  code: o.code === undefined ? 0 : o.code,
  signal: o.signal ?? null,
  message: o.message ?? null,
  status: o.status ?? null,
});

/**
 * Starts the mock on 127.0.0.1.
 * @param {object} options mode, flaws, limits, canaryToken, canaryPaths, netStyle, legacyShape, noPackages,
 *   unsafeLoopMs (how long 'loop-runs-long' hangs, default 60000), apiDownMs (default 15000), port
 * @returns {Promise<{url: string, port: number, flaws: Set<string>, close: () => Promise<void>}>}
 */
export function startMock(options = {}) {
  const mode = options.mode ?? 'safe';
  const flaws = new Set(options.flaws ?? (mode === 'unsafe' ? UNSAFE_FLAWS : []));
  for (const f of flaws) if (!FLAWS[f]) throw new Error(`unknown flaw: ${f}`);
  const limits = options.limits ?? lib.DEFAULT_LIMITS;
  const canaryToken = options.canaryToken ?? 'CC-CANARY-0123456789abcdef0123456789abcdef';
  const canaryPaths = options.canaryPaths ?? [];
  const netStyle = options.netStyle ?? 'errno';
  const unsafeLoopMs = options.unsafeLoopMs ?? 60_000;
  const apiDownMs = options.apiDownMs ?? 15_000;
  const installed = new Set(options.noPackages ? [] : RUNTIMES.map((r) => r.key));
  const timers = new Set();
  let apiDownUntil = 0;

  const shape = (s) => {
    if (!options.legacyShape) return s;
    const { status, message, ...rest } = s; // older Piston: no `status`, no `message`
    void status;
    void message;
    return rest;
  };

  // ---- canned answers ---------------------------------------------------------
  function answer(scenario, lang) {
    const has = (f) => flaws.has(f);
    switch (scenario) {
      case 'sanity':
        return { run: stage({ stdout: has('hello-broken') ? '' : `${lib.HELLO_MARKER}\n` }) };

      case 'infinite-loop':
        if (has('loop-runs-long')) return { delayMs: unsafeLoopMs, run: stage({ code: null, signal: 'SIGKILL', status: 'TO', message: 'Timed out' }) };
        return {
          delayMs: limits.runTimeoutMs,
          run: lang === 'python'
            ? stage({ code: null, signal: 'SIGKILL', status: 'TO', message: 'Timed out' })
            : stage({ code: null, signal: 'SIGXCPU', status: 'SG', message: 'CPU time limit exceeded' }),
        };

      case 'fork-bomb': {
        const afterwards = has('api-dies-after-fork') ? () => { apiDownUntil = Date.now() + apiDownMs; } : undefined;
        if (has('fork-clean-exit')) return { run: stage({ stdout: 'forked 100000 processes\n', code: 0 }), afterwards };
        return {
          delayMs: lang === 'python' ? 50 : limits.runTimeoutMs,
          run: lang === 'python'
            ? stage({ stderr: 'BlockingIOError: [Errno 11] Resource temporarily unavailable\n', code: 1, status: 'RE' })
            : stage({ code: null, signal: 'SIGKILL', status: 'TO', message: 'Timed out' }),
          afterwards,
        };
      }

      case 'huge-output': {
        if (has('output-unbounded')) return { run: stage({ stdout: 'A'.repeat(3 * lib.MIB), code: 0 }) };
        // Worst case for a correct Piston: the chunk that crosses the cap is still kept, so 2 x the cap.
        return { run: stage({ stdout: 'A'.repeat(2 * limits.outputMaxBytes), code: null, signal: 'SIGKILL', status: 'OL', message: 'stdout length exceeded' }) };
      }

      case 'huge-stderr': {
        if (has('stderr-unbounded')) return { run: stage({ stderr: 'E'.repeat(3 * lib.MIB), code: 0 }) };
        return { run: stage({ stderr: 'E'.repeat(2 * limits.outputMaxBytes), code: null, signal: 'SIGKILL', status: 'EL', message: 'stderr length exceeded' }) };
      }

      case 'file-access': {
        const lines = [];
        for (const step of lib.fsProbePlan(lang, canaryPaths)) {
          let verdict = step.expect === 'BLOCKED' ? 'BLOCKED' : 'ALLOWED';
          let detail = step.expect === 'BLOCKED' ? 'PermissionError errno=13' : step.expect === 'ALLOWED' ? 'opened and read 64 bytes' : 'entries=0';
          const flip = (id, d) => { if (step.id === id) { verdict = 'ALLOWED'; detail = d; } };
          if (has('file-read')) flip('read:/etc/shadow', 'opened and read 64 bytes');
          if (has('canary-leak') && canaryPaths[0]) flip(`read:${canaryPaths[0]}`, `opened and read 43 bytes content=${canaryToken}`);
          if (has('root-listable')) flip('list:/root', 'entries=24');
          if (has('home-nonempty')) flip('list:/home', 'entries=2');
          if (has('write-etc')) flip('write:/etc', 'created a file in /etc');
          if (has('docker-sock')) flip('stat:/var/run/docker.sock', 'visible inside the sandbox');
          if (has('proc-environ')) flip('scan:/proc/*/environ', 'readable: pid 1 PISTON_RUN_TIMEOUT');
          if (has('proc-root')) flip('root:/proc/1/root', 'a different root directory is reachable');
          if (has('probe-broken') && step.expect === 'ALLOWED') { verdict = 'BLOCKED'; detail = 'PermissionError errno=13'; }
          lines.push(`CCPROBE\t${step.id}\t${verdict}\t${detail}`);
        }
        return { run: stage({ stdout: `${lines.join('\n')}\n` }) };
      }

      case 'env-leak': {
        const env = [['LC_CTYPE', 'C.UTF-8'], ['PATH', '/piston/packages/python/3.10.0/bin:/usr/bin:/bin'], ['PISTON_LANGUAGE', lang === 'python' ? 'python' : 'c++']];
        if (has('env-leak')) env.push(['PISTON_RUN_MEMORY_LIMIT', String(limits.runMemoryBytes)], ['CANARY_ENV_SECRET', canaryToken]);
        if (has('env-secret')) env.push(['AWS_SECRET_ACCESS_KEY', 'not-a-real-key'], ['DATABASE_URL', 'postgres://user:pw@db.example.com/app']);
        if (has('env-value-leak')) env.push(['MOTD', `welcome ${canaryToken}`]);
        return { run: stage({ stdout: env.map(([k, v]) => `CCENV\t${k}\t${v}`).join('\n') + '\n' }) };
      }

      case 'network': {
        const broken = ['net-soft', 'net-connect', 'metadata-reachable', 'dns-works'].some(has);
        if (netStyle === 'sigsys' && !broken) {
          return { run: stage({ code: null, signal: 'SIGSYS', status: 'SG', message: 'Bad system call' }) };
        }
        const lines = [];
        for (const step of lib.netProbePlan(lang)) {
          let verdict = 'BLOCKED';
          let detail = step.kind === 'dns' ? 'phase=resolve gaierror' : step.kind === 'http' ? 'phase=http URLError (OSError)' : 'phase=socket PermissionError errno=13';
          // Empty network namespace: socket() works, every connect() is "Network is unreachable".
          if (netStyle === 'netns' && step.kind === 'tcp') detail = lang === 'python' ? 'phase=connect OSError errno=101' : 'phase=connect errno=101 Network is unreachable';
          if (has('net-soft') && step.kind === 'tcp') detail = 'phase=connect ConnectionRefusedError errno=111';
          if (has('net-connect') && step.id === 'tcp:172.17.0.1:22') { verdict = 'ALLOWED'; detail = 'phase=connect connected to 172.17.0.1:22'; }
          if (has('metadata-reachable') && step.id.includes('169.254.169.254')) { verdict = 'ALLOWED'; detail = 'phase=http server answered HTTP 401'; }
          if (has('dns-works') && step.kind === 'dns') { verdict = 'ALLOWED'; detail = 'phase=resolve resolved to 93.184.216.34'; }
          lines.push(`CCPROBE\t${step.id}\t${verdict}\t${detail}`);
        }
        return { run: stage({ stdout: `${lines.join('\n')}\n` }) };
      }

      case 'memory-bomb':
        if (has('mem-survives')) return { run: stage({ stdout: `${lib.MEMORY_SURVIVED_MARKER}\n`, code: 0 }) };
        if (has('mem-timeout')) return { delayMs: limits.runTimeoutMs, run: stage({ code: null, signal: 'SIGKILL', status: 'TO', message: 'Timed out' }) };
        return {
          run: lang === 'python'
            ? stage({ stderr: 'MemoryError\n', code: 1, status: 'RE' })
            : stage({ stderr: 'terminate called after throwing an instance of std::bad_alloc\n', code: null, signal: 'SIGABRT', status: 'SG' }),
        };

      default:
        // Unknown program (for example a hand-written request): behave like a program that prints nothing.
        return { run: stage({}) };
    }
  }

  // ---- HTTP plumbing ------------------------------------------------------------
  const sendJson = (res, status, body) => {
    const text = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
    res.end(text);
  };

  const readBody = (req) =>
    new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > lib.MIB) reject(new Error('body too large'));
        else chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });

  const pause = (ms, res) =>
    new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      timers.add(t);
      res.on('close', () => {
        clearTimeout(t);
        resolve();
      });
    });

  async function execute(req, res) {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return sendJson(res, 400, { message: 'request body must be JSON' });
    }
    const wanted = String(body.language ?? '').toLowerCase();
    const runtime = RUNTIMES.find((r) => r.info.language === wanted || r.info.aliases.includes(wanted));
    if (!runtime || !installed.has(runtime.key)) return sendJson(res, 400, { message: `${body.language}-${body.version} runtime is unknown` });
    const source = body.files?.[0]?.content;
    if (typeof source !== 'string') return sendJson(res, 400, { message: 'files[0].content is required' });

    if (!flaws.has('limits-raisable')) {
      for (const [field, key] of Object.entries(LIMIT_FIELDS)) {
        const cap = limits[key];
        const given = body[field];
        if (given === undefined || cap < 0) continue;
        if (given > cap || (field.endsWith('memory_limit') && given < 0)) {
          return sendJson(res, 400, { message: `${field} cannot exceed the configured limit of ${cap}` });
        }
      }
    }

    const scenario = scenarioOfSource(source);
    const result = answer(scenario, runtime.lang);
    if (result.delayMs) {
      await pause(result.delayMs, res);
      if (res.destroyed || res.writableEnded) return undefined;
    }
    result.afterwards?.();
    const payload = { language: runtime.info.language, version: runtime.info.version, run: shape(result.run) };
    if (runtime.lang === 'cpp') payload.compile = shape(stage({}));
    return sendJson(res, 200, payload);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://mock.invalid');
      if (req.method === 'GET' && url.pathname === '/api/v2/runtimes') {
        if (Date.now() < apiDownUntil) return sendJson(res, 503, { message: 'mock: API is down (flaw api-dies-after-fork)' });
        return sendJson(res, 200, RUNTIMES.filter((r) => installed.has(r.key)).map((r) => r.info));
      }
      if (req.method === 'GET' && url.pathname === '/api/v2/packages') {
        return sendJson(res, 200, PACKAGES.map((p) => ({ language: p.language, language_version: p.language_version, installed: p.provides.every((k) => installed.has(k)) })));
      }
      if (req.method === 'POST' && url.pathname === '/api/v2/packages') {
        const { language, version } = JSON.parse(await readBody(req));
        const pkg = PACKAGES.find((p) => p.language === language && p.language_version === version);
        if (!pkg) return sendJson(res, 404, { message: 'Requested package does not exist' });
        if (pkg.provides.every((k) => installed.has(k))) return sendJson(res, 500, { message: 'Package is already installed' });
        for (const k of pkg.provides) installed.add(k);
        return sendJson(res, 200, { language, version });
      }
      if (req.method === 'POST' && url.pathname === '/api/v2/execute') return await execute(req, res);
      return sendJson(res, 404, { message: 'not found' });
    } catch (err) {
      return sendJson(res, 500, { message: String(err?.message ?? err) });
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        port,
        flaws,
        close: () =>
          new Promise((done) => {
            for (const t of timers) clearTimeout(t);
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

// ---- command line -------------------------------------------------------------
async function main() {
  const env = process.env;
  const mode = env.MODE === 'unsafe' ? 'unsafe' : 'safe';
  const here = path.dirname(fileURLToPath(import.meta.url));
  let limits = lib.DEFAULT_LIMITS;
  try {
    limits = lib.limitsFromEnv(lib.parseEnvFile(readFileSync(env.LIMITS_ENV_FILE || path.join(here, '..', 'piston', 'limits.env'), 'utf8')));
  } catch {
    // fall back to the built-in defaults
  }
  const flaws = (env.FLAWS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const mock = await startMock({
    mode,
    flaws: flaws.length > 0 ? flaws : undefined,
    limits,
    port: env.PORT ? Number(env.PORT) : 0,
    netStyle: ['sigsys', 'netns'].includes(env.NET_STYLE) ? env.NET_STYLE : 'errno',
    legacyShape: env.LEGACY_SHAPE === '1',
    noPackages: env.NO_PACKAGES === '1',
    canaryToken: env.CANARY_TOKEN || undefined,
    canaryPaths: (env.CANARY_PATH ?? '').split(':').filter(Boolean),
  });
  console.log(`mock-piston listening on ${mock.url} (mode=${mode}${mock.flaws.size ? `, flaws=${[...mock.flaws].join(',')}` : ''})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
