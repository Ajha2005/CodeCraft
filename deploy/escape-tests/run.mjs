#!/usr/bin/env node
// =============================================================================
// Piston escape tests: runner.
//
//   PISTON_URL=http://127.0.0.1:2000 CANARY_PATH=/root/cc-canary.txt \
//     CANARY_TOKEN=... node deploy/escape-tests/run.mjs
//
// Submits attack programs (programs.mjs) to a Piston API and judges the answers
// (lib.mjs): infinite loop, fork bomb, 100 MB of stdout and of stderr, file and
// environment snooping, outbound network, memory bomb, raising limits per request,
// plus a hello-world sanity check. Prints a PASS/FAIL table and exits 1 on any FAIL.
//
// This really runs a fork bomb and a memory bomb against the target, so it refuses
// any target that is not on this machine (loopback) unless ALLOW_REMOTE=1. On the
// EC2 box start it through run-in-docker.sh: that checks first that the Piston
// container has the memory and pids limits it is supposed to have, plants the
// canary files, and watches that the container survives.
//
// Environment (all optional):
//   PISTON_URL        target API, default http://127.0.0.1:2000 (loopback only)
//   ALLOW_REMOTE=1    allow a target that is not loopback: only for a Piston you own
//   LIMITS_ENV_FILE   limits to judge against, default ../piston/limits.env
//   CANARY_PATH       colon-separated paths of root-only canary files planted in the target
//   CANARY_TOKEN      the secret inside those files
//   ONLY              comma-separated scenario names to run (default: all)
//   LANGS             comma-separated: python,cpp (default: both)
//   WALL_SLACK_MS     override T1 slack (default 5000), API_RECOVERY_MS override T2 (default 10000)
//   VERBOSE=1         progress on stderr and untruncated details
//
// Exit status: 0 all PASS, 1 at least one FAIL, 2 the tests could not run.
// Requires Node >= 20 (global fetch). No dependencies.
// =============================================================================
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import * as lib from './lib.mjs';
import { buildProgram } from './programs.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Scenarios that burn CPU, processes, memory or output volume, so the API is
 * pinged again after each of them (T2). The two left out, file-access and
 * env-leak, only read; run-in-docker.sh checks the container and the API once
 * more after the whole run.
 */
const ATTACKS_NEEDING_LIVENESS = new Set(['infinite-loop', 'fork-bomb', 'huge-output', 'huge-stderr', 'memory-bomb', 'network']);

/** Where a hostile program may be sent without asking for ALLOW_REMOTE=1. */
export function targetProblem(rawUrl, allowRemote = false) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return `PISTON_URL is not a valid URL: ${rawUrl}`;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return `PISTON_URL must be http:// or https://, got ${url.protocol}`;
  if (url.username || url.password) return 'PISTON_URL must not contain a user name or password';
  const host = url.hostname;
  const loopback = host === 'localhost' || host === '[::1]' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
  if (!loopback && !allowRemote) {
    return `refusing to run a fork bomb, a memory bomb and 100 MB of output against ${host}: it is not this machine. Use a loopback URL, or set ALLOW_REMOTE=1 if that Piston is yours and nobody uses it.`;
  }
  return null;
}

// -----------------------------------------------------------------------------
// HTTP
// -----------------------------------------------------------------------------

/**
 * One request with a hard client-side deadline and a cap on how much of the
 * body is read. Never throws; failures come back as {error}.
 * @returns {Promise<{error?: string, httpStatus?: number, elapsedMs: number, bytes: number, text?: string, json?: any, truncated?: boolean}>}
 */
export async function httpJson(url, { method = 'GET', body, deadlineMs, maxBytes }) {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('deadline')), deadlineMs);
  let bytes = 0;
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const chunks = [];
    let truncated = false;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > maxBytes) {
        truncated = true;
        await reader.cancel().catch(() => {});
        break;
      }
      chunks.push(value);
    }
    const text = truncated ? '' : Buffer.concat(chunks).toString('utf8');
    let json;
    if (!truncated) {
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
    }
    return { httpStatus: res.status, elapsedMs: performance.now() - started, bytes, text, json, truncated };
  } catch (err) {
    const elapsedMs = performance.now() - started;
    if (controller.signal.aborted) return { error: 'deadline', elapsedMs, bytes };
    return { error: err?.cause?.code || err?.code || err?.name || String(err), elapsedMs, bytes };
  } finally {
    clearTimeout(timer);
  }
}

/** T2: polls GET /api/v2/runtimes until it answers 200 + a JSON array, or the time is up. */
export async function waitForApi(base, { withinMs, intervalMs, probeTimeoutMs }) {
  const started = performance.now();
  let last = 'no answer';
  for (;;) {
    const r = await httpJson(`${base}/api/v2/runtimes`, { deadlineMs: probeTimeoutMs, maxBytes: lib.MIB });
    if (r.httpStatus === 200 && Array.isArray(r.json)) return { alive: true, withinMs, waitedMs: Math.round(performance.now() - started) };
    last = r.error ?? `HTTP ${r.httpStatus}`;
    if (performance.now() - started >= withinMs) return { alive: false, withinMs, last };
    await sleep(intervalMs);
  }
}

// -----------------------------------------------------------------------------
// The test run
// -----------------------------------------------------------------------------

/**
 * Runs the scenarios against one Piston API.
 * @param {object} options pistonUrl, limits, thresholds (partial), canaryToken, canaryPaths, only, langs, log
 * @returns {Promise<{rows: {name: string, lang: string, ok: boolean, detail: string}[], summary: object}>}
 */
export async function runAll(options = {}) {
  const base = (options.pistonUrl ?? 'http://127.0.0.1:2000').replace(/\/+$/, '');
  const limits = options.limits ?? lib.DEFAULT_LIMITS;
  const thresholds = { ...lib.THRESHOLDS, ...(options.thresholds ?? {}) };
  const canaryPaths = lib.validateCanaryPaths(options.canaryPaths ?? []);
  const ctx = { limits, thresholds, canaryToken: options.canaryToken ?? '', canaryPaths };
  const langs = (options.langs ?? ['python', 'cpp']).filter((l) => lib.LANGS[l]);
  const only = options.only?.length ? new Set(options.only) : null;
  const log = options.log ?? (() => {});

  const execute = (lang, source, extra = {}) =>
    httpJson(`${base}/api/v2/execute`, {
      method: 'POST',
      body: {
        language: lib.LANGS[lang].language,
        version: lib.LANGS[lang].version,
        files: [{ name: lib.LANGS[lang].file, content: source }],
        ...extra,
      },
      deadlineMs: lib.budgetMs(lang, limits, thresholds),
      maxBytes: thresholds.responseReadCapBytes,
    });

  const liveness = () =>
    waitForApi(base, {
      withinMs: thresholds.apiRecoveryMs,
      intervalMs: thresholds.apiPollIntervalMs,
      probeTimeoutMs: thresholds.apiProbeTimeoutMs,
    });

  // Each request is sent with no limits of its own, so only what the Piston
  // container itself enforces (limits.env) can stop the program.
  async function programScenario(name, lang) {
    const res = await execute(lang, buildProgram(name, lang, { canaryPaths }));
    const after = ATTACKS_NEEDING_LIVENESS.has(name) ? await liveness() : undefined;
    return lib.EVALUATORS[name]({ res, lang, ctx, after });
  }

  // Asks for MORE than each configured cap; Piston must answer HTTP 400.
  async function limitRaiseScenario() {
    const fields = [
      { field: 'run_timeout', cap: limits.runTimeoutMs, lang: 'python' },
      { field: 'run_cpu_time', cap: limits.runCpuTimeMs, lang: 'python' },
      { field: 'run_memory_limit', cap: limits.runMemoryBytes, lang: 'python' },
      { field: 'compile_timeout', cap: limits.compileTimeoutMs, lang: 'cpp' },
      { field: 'compile_cpu_time', cap: limits.compileCpuTimeMs, lang: 'cpp' },
      { field: 'compile_memory_limit', cap: limits.compileMemoryBytes, lang: 'cpp' },
    ].filter((f) => f.cap > 0);
    const attempts = [];
    for (const { field, cap, lang } of fields) {
      const value = cap * 10;
      const res = await execute(lang, buildProgram('sanity', lang), { [field]: value });
      attempts.push({ field, value, res });
    }
    return lib.evalLimitRaise({ attempts, ctx });
  }

  const rows = [];
  for (const name of lib.SCENARIOS) {
    if (only && !only.has(name)) continue;
    const perLang = name === 'limit-raise' ? [null] : langs;
    for (const lang of perLang) {
      const label = lang ? lib.LANGS[lang].label : 'any';
      log(`running ${name} (${label}) ...`);
      let verdict;
      try {
        verdict = lang ? await programScenario(name, lang) : await limitRaiseScenario();
      } catch (err) {
        verdict = { ok: false, detail: `internal error in the test harness: ${err?.stack || err}` };
      }
      rows.push({ name, lang: label, ok: verdict.ok, detail: verdict.detail });
    }
  }
  return { rows, summary: lib.summarize(rows) };
}

// -----------------------------------------------------------------------------
// Command line
// -----------------------------------------------------------------------------

const intEnv = (name) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative integer`);
  return n;
};
const listEnv = (name) => (process.env[name] ?? '').split(',').map((s) => s.trim()).filter(Boolean);

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 20) {
    console.error('Node >= 20 is required (global fetch).');
    return 2;
  }
  const verbose = process.env.VERBOSE === '1';
  const pistonUrl = process.env.PISTON_URL || 'http://127.0.0.1:2000';
  const refused = targetProblem(pistonUrl, process.env.ALLOW_REMOTE === '1');
  if (refused) {
    console.error(refused);
    return 2;
  }

  const explicitLimits = process.env.LIMITS_ENV_FILE;
  const limitsFile = explicitLimits || path.join(HERE, '..', 'piston', 'limits.env');
  let limits = lib.DEFAULT_LIMITS;
  let limitsSource = 'built-in defaults (same values as deploy/piston/limits.env)';
  try {
    limits = lib.limitsFromEnv(lib.parseEnvFile(readFileSync(limitsFile, 'utf8')));
    limitsSource = limitsFile;
  } catch (err) {
    if (explicitLimits) {
      console.error(`Cannot read LIMITS_ENV_FILE=${explicitLimits}: ${err.message}`);
      return 2;
    }
  }

  const canaryPaths = (process.env.CANARY_PATH ?? '').split(':').map((s) => s.trim()).filter(Boolean);
  const canaryToken = process.env.CANARY_TOKEN ?? '';
  const only = listEnv('ONLY');
  const langs = listEnv('LANGS');
  const unknown = [...only.filter((n) => !lib.SCENARIOS.includes(n)), ...langs.filter((l) => !lib.LANGS[l])];
  if (unknown.length > 0) {
    console.error(`Unknown ONLY/LANGS value(s): ${unknown.join(', ')}. Scenarios: ${lib.SCENARIOS.join(', ')}. Languages: ${Object.keys(lib.LANGS).join(', ')}.`);
    return 2;
  }
  const thresholds = {};
  if (intEnv('WALL_SLACK_MS') !== undefined) thresholds.wallSlackMs = intEnv('WALL_SLACK_MS');
  if (intEnv('API_RECOVERY_MS') !== undefined) thresholds.apiRecoveryMs = intEnv('API_RECOVERY_MS');

  console.log(`Piston escape tests -> ${pistonUrl}`);
  console.log(`limits: run ${limits.runTimeoutMs} ms, compile ${limits.compileTimeoutMs} ms, output ${limits.outputMaxBytes} B, run memory ${limits.runMemoryBytes} B (from ${limitsSource})`);
  if (canaryPaths.length === 0) console.log('note: CANARY_PATH is not set, so the planted-canary reads are skipped (run-in-docker.sh sets it)');
  console.log('note: this runs a real fork bomb, memory bomb and 100 MB of output against the target; on the EC2 box use run-in-docker.sh\n');

  const merged = { ...lib.THRESHOLDS, ...thresholds };
  const alive = await waitForApi(pistonUrl.replace(/\/+$/, ''), { withinMs: 5000, intervalMs: merged.apiPollIntervalMs, probeTimeoutMs: merged.apiProbeTimeoutMs });
  if (!alive.alive) {
    console.error(`Piston does not answer GET ${pistonUrl}/api/v2/runtimes (${alive.last}). Nothing was tested.`);
    return 2;
  }

  const { rows, summary } = await runAll({
    pistonUrl,
    limits,
    thresholds,
    canaryPaths,
    canaryToken,
    only,
    langs: langs.length > 0 ? langs : undefined,
    log: verbose ? (m) => console.error(m) : undefined,
  });

  console.log(lib.formatTable(rows, { detailWidth: verbose ? Number.MAX_SAFE_INTEGER : 118 }));
  console.log(`\n${summary.total} checks: ${summary.passed} PASS, ${summary.failed} FAIL`);
  if (!summary.ok) console.log('RESULT: FAIL: at least one attack was not contained. See deploy/escape-tests/README.md for what each FAIL means.');
  else console.log('RESULT: PASS: every attack was contained.');
  return summary.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err?.stack || err);
      process.exit(2);
    },
  );
}
