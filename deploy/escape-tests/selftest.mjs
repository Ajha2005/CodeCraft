#!/usr/bin/env node
// =============================================================================
// Self-test of the escape-test harness. Needs no Docker, no Piston, no network:
//
//   node deploy/escape-tests/selftest.mjs
//
// It proves that the harness says PASS for a correctly behaving Piston and FAIL,
// for the right reason, for each way a Piston can misbehave:
//   1. pure functions (lib.mjs) on hand-made responses, boundaries included
//   2. limits.env stays in sync with the harness defaults
//   3. the attack programs: valid code, same probe list as the checks expect
//   4. the whole harness against mock-piston.mjs: safe, unsafe, and one flaw at
//      a time (each must fail ONLY its own scenario)
//   5. the real command line: exit status 0 for safe, 1 for unsafe, 2 if unreachable
//      or if the target is not this machine
//   6. guard rails on the shell scripts (bash -n, shellcheck when installed)
//   7. run-in-docker.sh itself, driven by a fake `docker` (fake-docker.mjs) and the
//      mock Piston: exit status 0 / 1 / 2, loopback only, the canary files planted
//      and removed again, and no docker command that could change the container
// Timeouts are scaled down (300 ms instead of 3000 ms) so it finishes in about a minute.
// Exit status 0 = all good. Needs Node >= 20. python3, g++, bash, curl and shellcheck
// are used when present and reported as skipped when not.
// =============================================================================
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as lib from './lib.mjs';
import { buildProgram, PROGRAM_SCENARIOS, scenarioOfSource } from './programs.mjs';
import { FLAWS, startMock } from './mock-piston.mjs';
import { httpJson, runAll, targetProblem, waitForApi } from './run.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEPLOY = path.join(HERE, '..');

// ---- tiny test framework ---------------------------------------------------------
let total = 0;
let failed = 0;
let sectionTotal = 0;
let sectionFailed = 0;
function check(name, condition, detail = '') {
  total++;
  sectionTotal++;
  if (!condition) {
    failed++;
    sectionFailed++;
    console.log(`  FAIL  ${name}${detail ? `\n          ${String(detail).split('\n').join('\n          ')}` : ''}`);
  }
}
async function section(title, fn) {
  console.log(`\n== ${title}`);
  sectionTotal = 0;
  sectionFailed = 0;
  try {
    await fn();
  } catch (err) {
    check(`section "${title}" threw`, false, err?.stack || String(err));
  }
  console.log(`   ${sectionFailed === 0 ? 'ok' : 'FAILED'} (${sectionTotal - sectionFailed}/${sectionTotal} checks)`);
}
const skip = (what) => console.log(`   skipped: ${what}`);
const has = (cmd) => spawnSync(cmd, ['--version'], { stdio: 'ignore' }).error === undefined;

// ---- shared fixtures ---------------------------------------------------------------
const TOKEN = `${lib.CANARY_PREFIX}${'ab12cd34'.repeat(4)}`;
const CANARIES = ['/root/cc-canary.txt', '/var/tmp/cc-canary.txt'];
const LIM = lib.DEFAULT_LIMITS;
const TH = lib.THRESHOLDS;
const CTX = { limits: LIM, thresholds: TH, canaryToken: TOKEN, canaryPaths: CANARIES };
const ALIVE = { alive: true, withinMs: TH.apiRecoveryMs };

const stg = (o = {}) => ({ stdout: '', stderr: '', output: '', code: 0, signal: null, message: null, status: null, ...o });
const respond = (run, { compile, elapsedMs = 120, bytes } = {}) => {
  const body = { language: 'python', version: '3.10.0', run, ...(compile ? { compile } : {}) };
  const text = JSON.stringify(body);
  return { httpStatus: 200, elapsedMs, bytes: bytes ?? text.length, text, json: body };
};
const probeLines = (rows) => rows.map(([id, verdict, detail]) => `CCPROBE\t${id}\t${verdict}\t${detail}`).join('\n') + '\n';
const goodFileProbes = (lang) =>
  lib.fsProbePlan(lang, CANARIES).map((s) => [s.id, s.expect === 'BLOCKED' ? 'BLOCKED' : 'ALLOWED', s.expect === 'BLOCKED' ? 'PermissionError errno=13' : s.expect === 'ALLOWED' ? 'opened and read 64 bytes' : 'entries=0']);
const goodNetProbes = (lang) =>
  lib.netProbePlan(lang).map((s) => [s.id, 'BLOCKED', s.kind === 'dns' ? 'phase=resolve gaierror' : s.kind === 'http' ? 'phase=http URLError (PermissionError)' : 'phase=socket PermissionError errno=13']);
const evalWith = (fn, res, extra = {}) => fn({ res, lang: 'python', ctx: CTX, after: ALIVE, ...extra });

// =============================================================================
await section('1. lib.mjs: parsing, classification, leak detection', () => {
  // docker --env-file semantics
  const env = lib.parseEnvFile('# c\n\nA=1\r\nB=two words\nC=\nbad line\nD=x=y\n');
  check('parseEnvFile: key/value, CRLF tolerated, blank and comment skipped', env.A === '1' && env.B === 'two words' && env.C === '' && env.D === 'x=y' && !('bad line' in env));
  check('validateEnvFileText accepts a clean file', lib.validateEnvFileText('# c\nPISTON_RUN_TIMEOUT=3000\n\nPISTON_LOG_LEVEL=INFO\n').length === 0);
  check('validateEnvFileText rejects quotes', lib.validateEnvFileText('PISTON_X="1"\n').length === 1);
  check('validateEnvFileText rejects a trailing comment', lib.validateEnvFileText('PISTON_X=1 # why\n').length === 1);
  check('validateEnvFileText rejects CR characters', lib.validateEnvFileText('PISTON_X=1\r\n').length >= 1);
  check('validateEnvFileText rejects a non-PISTON key', lib.validateEnvFileText('export PISTON_X=1\n').length === 1);

  // stage classification, with and without Piston's two-letter status
  const k = (s) => lib.classifyStage(s).kind;
  check('classify: status TO', k(stg({ status: 'TO', signal: 'SIGKILL', code: null })) === 'timeout');
  check('classify: status SG', k(stg({ status: 'SG', signal: 'SIGSEGV', code: null })) === 'signal');
  check('classify: status RE', k(stg({ status: 'RE', code: 1 })) === 'runtime_error');
  check('classify: status OL / EL', k(stg({ status: 'OL' })) === 'output_limit' && k(stg({ status: 'EL' })) === 'stderr_limit');
  check('classify: status XX is an internal error, not a pass', k(stg({ status: 'XX' })) === 'internal');
  check('classify: no status, signal set -> signal', k(stg({ signal: 'SIGKILL', code: null })) === 'signal');
  check('classify: no status, exit 1 -> runtime_error; exit 0 -> ok', k(stg({ code: 1 })) === 'runtime_error' && k(stg({ code: 0 })) === 'ok');
  check('classify: nothing at all -> unknown, and a missing stage -> missing', k({}) === 'unknown' && k(undefined) === 'missing');
  check('classify: exit 152 (128+SIGXCPU behind a shell) counts as killed', lib.classifyStage(stg({ code: 152 })).killed === true);
  check('classify: exit 1 is not "killed"', lib.classifyStage(stg({ code: 1 })).killed === false);

  // probe protocol
  const pr = lib.parseProbeLines('noise\nCCPROBE\ta\tBLOCKED\tx\nCCPROBE\tb\tALLOWED\ty\tz\nCCPROBE\ta\tALLOWED\tagain\nCCPROBE\tbroken\n');
  check('parseProbeLines: ignores noise and malformed lines', pr.size === 2 && !pr.has('broken'));
  check('parseProbeLines: ALLOWED wins a duplicated id', pr.get('a').verdict === 'ALLOWED');
  check('parseProbeLines: detail keeps embedded tabs', pr.get('b').detail === 'y\tz');
  check('parseEnvDump reads CCENV lines', lib.parseEnvDump('CCENV\tPATH\t/bin\nzzz\nCCENV\tA\t\n').length === 2);

  // leak detection must catch secrets and must not cry wolf
  const L = (t) => lib.findLeaks(t, { canaryToken: TOKEN });
  check('findLeaks: exact canary token', L(`x ${TOKEN} y`).includes('canary token'));
  check('findLeaks: canary-shaped token without knowing the token', lib.findLeaks(`${lib.CANARY_PREFIX}0123456789abcdef`, {}).length === 1);
  check('findLeaks: /etc/shadow line', L('root:$6$abc$defghi:19000:0:99999:7:::').length === 1 && L('daemon:*:19000:0:99999:7:::').length === 1);
  check('findLeaks: private key, AWS key id, JWT', L('-----BEGIN OPENSSH PRIVATE KEY-----').length === 1 && L('AKIAABCDEFGHIJKLMNOP').length === 1 && L('eyJhbGciOiJI.eyJzdWIiOiIx.SflKxwRJSMeK').length === 1);
  check('findLeaks: ordinary output is clean', L('root:x:0:0:root:/root:/bin/bash\nPermissionError: [Errno 13] Permission denied\nCCPROBE\tread:/etc/shadow\tBLOCKED\tx').length === 0);

  // thresholds
  const worstCaseResponse = 2 * (2 * LIM.outputMaxBytes) + 1000; // stdout and `output`, each up to 2 x the cap, plus JSON
  check('T3: the response-size limit is above the worst case of a correct Piston (a flat 256 KiB would not be)', lib.maxResponseBytes(LIM, TH) > worstCaseResponse && 256 * lib.KIB < worstCaseResponse, `limit ${lib.maxResponseBytes(LIM, TH)}, worst case ${worstCaseResponse}`);
  check('T3: ...but far below a runaway 100 MB output', lib.maxResponseBytes(LIM, TH) < lib.MIB);
  check('T1: C++ budget includes the compile timeout, Python does not', lib.budgetMs('cpp', LIM, TH) - lib.budgetMs('python', LIM, TH) === LIM.compileTimeoutMs && lib.budgetMs('python', LIM, TH) === LIM.runTimeoutMs + 5000);
  check('summarize/formatTable basics', lib.summarize([{ ok: true }, { ok: false }]).failed === 1 && lib.summarize([]).ok === false && lib.formatTable([{ name: 'x', lang: 'python', ok: false, detail: 'd' }]).includes('FAIL'));
});

// =============================================================================
await section('2. limits.env and the harness defaults cannot drift apart', () => {
  const file = path.join(DEPLOY, 'piston', 'limits.env');
  const text = fs.readFileSync(file, 'utf8');
  check('limits.env passes the format rules run-piston.sh enforces', lib.validateEnvFileText(text).length === 0, lib.validateEnvFileText(text).join('\n'));
  const parsed = lib.parseEnvFile(text);
  check('limits.env defines exactly the 13 expected variables', JSON.stringify(Object.keys(parsed).sort()) === JSON.stringify(Object.keys(lib.DEFAULT_ENV).sort()), Object.keys(parsed).join(' '));
  for (const [key, value] of Object.entries(lib.DEFAULT_ENV)) check(`limits.env ${key}=${value} matches DEFAULT_ENV`, parsed[key] === value, `file says ${parsed[key]}`);
  check('the harness derives its limits from the file identically', JSON.stringify(lib.limitsFromEnv(parsed)) === JSON.stringify(lib.DEFAULT_LIMITS));
  check('networking is disabled and memory is capped in limits.env', parsed.PISTON_DISABLE_NETWORKING === 'true' && Number(parsed.PISTON_RUN_MEMORY_LIMIT) > 0 && Number(parsed.PISTON_COMPILE_MEMORY_LIMIT) > 0);
});

// =============================================================================
await section('3. lib.mjs evaluators on hand-made responses (strict, boundaries included)', () => {
  // infinite loop
  const loop = (run, extra, after = ALIVE) => lib.evalInfiniteLoop({ res: respond(run, extra), lang: 'python', ctx: CTX, after });
  check('loop: TO passes', loop(stg({ status: 'TO', signal: 'SIGKILL', code: null })).ok);
  check('loop: SG passes', loop(stg({ status: 'SG', signal: 'SIGXCPU', code: null })).ok);
  check('loop: exit 152 behind a shell passes', loop(stg({ code: 152 })).ok);
  check('loop: clean exit fails', !loop(stg({ code: 0 })).ok);
  check('loop: plain runtime error (exit 1) fails', !loop(stg({ code: 1, status: 'RE' })).ok);
  check('loop: API down afterwards fails', !loop(stg({ status: 'TO', signal: 'SIGKILL', code: null }), {}, { alive: false, withinMs: 10000, last: 'ECONNREFUSED' }).ok);
  check('loop: missing liveness check fails (internal error, never a silent pass)', !lib.evalInfiniteLoop({ res: respond(stg({ status: 'TO', code: null })), lang: 'python', ctx: CTX, after: undefined }).ok);
  check('loop: client deadline fails', !lib.evalInfiniteLoop({ res: { error: 'deadline', elapsedMs: 8000, bytes: 0 }, lang: 'python', ctx: CTX, after: ALIVE }).ok);
  check('loop: answered after the budget fails', !loop(stg({ status: 'TO', code: null }), { elapsedMs: 9000 }).ok);
  check('loop: reported wall_time over the budget fails', !loop(stg({ status: 'TO', code: null, wall_time: 60000 })).ok);
  check('loop: HTTP 500 fails', !lib.evalInfiniteLoop({ res: { httpStatus: 500, elapsedMs: 5, bytes: 4, text: 'boom' }, lang: 'python', ctx: CTX, after: ALIVE }).ok);
  check('loop (c++): a failed compile is reported as such', /compile step failed/.test(lib.evalInfiniteLoop({ res: respond(stg({ status: 'TO', code: null }), { compile: stg({ code: 1, stderr: 'error: boom' }) }), lang: 'cpp', ctx: CTX, after: ALIVE }).detail));

  // fork bomb
  const fork = (run) => lib.evalForkBomb({ res: respond(run), lang: 'python', ctx: CTX, after: ALIVE });
  check('fork: RE / SG / TO / non-zero exit all count as contained', fork(stg({ status: 'RE', code: 1 })).ok && fork(stg({ status: 'SG', signal: 'SIGKILL', code: null })).ok && fork(stg({ status: 'TO', code: null })).ok && fork(stg({ code: 137 })).ok);
  check('fork: clean exit is not contained', !fork(stg({ code: 0 })).ok);
  check('fork: Piston internal error (XX) is not contained', !fork(stg({ status: 'XX', code: null })).ok);

  // huge output, exactly at the boundary
  const cap = lib.maxResponseBytes(LIM, TH);
  const out = (run, bytes) => lib.evalHugeOutput({ res: respond(run, { bytes }), lang: 'python', ctx: CTX, after: ALIVE });
  const ol = stg({ status: 'OL', signal: 'SIGKILL', code: null, stdout: 'A'.repeat(100) });
  check('output: OL under the size limit passes', out(ol, cap - 1).ok);
  check('output: OL exactly at the size limit fails', !out(ol, cap).ok);
  check('output: OL but a 5 MB response fails', !out(ol, 5 * lib.MIB).ok);
  check('output: killed by a signal instead of OL passes', out(stg({ status: 'SG', signal: 'SIGKILL', code: null }), 1000).ok);
  check('output: clean exit with output fails', !out(stg({ code: 0, stdout: 'A'.repeat(100) }), 1000).ok);
  check('output: the "survived" marker fails even with a kill status', !out(stg({ status: 'OL', code: null, stdout: lib.OUTPUT_SURVIVED_MARKER }), 1000).ok);

  // huge stderr: same rules, Piston's status for it is EL
  const err = (run, bytes) => lib.evalHugeStderr({ res: respond(run, { bytes }), lang: 'python', ctx: CTX, after: ALIVE });
  const el = stg({ status: 'EL', signal: 'SIGKILL', code: null, stderr: 'E'.repeat(100) });
  check('stderr: EL under the size limit passes', err(el, cap - 1).ok);
  check('stderr: EL exactly at the size limit fails', !err(el, cap).ok);
  check('stderr: EL but a 5 MB response fails', !err(el, 5 * lib.MIB).ok);
  check('stderr: killed by a signal instead of EL passes', err(stg({ status: 'SG', signal: 'SIGKILL', code: null }), 1000).ok);
  check('stderr: clean exit fails and says stderr', /stderr was not cut off/.test(err(stg({ code: 0, stderr: 'E'.repeat(100) }), 1000).detail));
  check('stderr: the "survived" marker fails even with a kill status', !err(stg({ status: 'EL', code: null, stdout: lib.OUTPUT_SURVIVED_MARKER }), 1000).ok);
  check('stderr: API down afterwards fails', !lib.evalHugeStderr({ res: respond(el, { bytes: 1000 }), lang: 'python', ctx: CTX, after: { alive: false, withinMs: 10000, last: 'ECONNREFUSED' } }).ok);
  // memory bomb
  const mem = (run) => lib.evalMemoryBomb({ res: respond(run), lang: 'python', ctx: CTX, after: ALIVE });
  check('memory: RE (MemoryError) passes', mem(stg({ status: 'RE', code: 1, stderr: 'MemoryError' })).ok);
  check('memory: SG (abort) passes', mem(stg({ status: 'SG', signal: 'SIGABRT', code: null })).ok);
  check('memory: TO fails (the limit did not stop it)', !mem(stg({ status: 'TO', signal: 'SIGKILL', code: null })).ok);
  check('memory: survived marker fails', !mem(stg({ code: 0, stdout: lib.MEMORY_SURVIVED_MARKER })).ok);
  check('memory: clean exit fails', !mem(stg({ code: 0 })).ok);

  // files
  const files = (rows, run = {}) => lib.evalFileAccess({ res: respond(stg({ stdout: probeLines(rows), ...run })), lang: 'python', ctx: CTX });
  const baseFiles = goodFileProbes('python');
  const tweak = (id, verdict, detail) => baseFiles.map((r) => (r[0] === id ? [id, verdict, detail] : r));
  check('files: everything blocked, controls allowed, /home empty -> pass', files(baseFiles).ok);
  check('files: /home non-empty fails', !files(tweak('list:/home', 'ALLOWED', 'entries=2')).ok);
  check('files: /root listable fails (even if empty)', !files(tweak('list:/root', 'ALLOWED', 'entries=0')).ok);
  check('files: write into /usr fails', !files(tweak('write:/usr', 'ALLOWED', 'created a file')).ok);
  check('files: docker.sock visible fails', !files(tweak('stat:/var/run/docker.sock', 'ALLOWED', 'visible')).ok);
  check('files: failed control probe fails (a broken probe cannot give a green result)', /control probe failed/.test(files(tweak('control:read:/etc/passwd', 'BLOCKED', 'PermissionError')).detail));
  check('files: a missing probe line fails', !files(baseFiles.filter((r) => r[0] !== 'read:/etc/shadow')).ok);
  check('files: PID 1\'s environment readable (a PISTON_ variable) fails', !files(tweak('scan:/proc/*/environ', 'ALLOWED', 'readable: pid 1 PISTON_RUN_TIMEOUT')).ok);
  check('files: a different root directory reachable through /proc/1/root fails', !files(tweak('root:/proc/1/root', 'ALLOWED', 'a different root directory is reachable')).ok);
  check('files: /proc/1/root that is the job\'s own root passes (a harmless PID-namespace init)', files(tweak('root:/proc/1/root', 'BLOCKED', 'same directory as this job\'s own root')).ok);
  check('files: write into an interpreter package directory fails', !files(tweak('write:/piston/packages/python/3.10.0', 'ALLOWED', 'created a file')).ok);
  check('files: write into the Piston server code directory fails', !files(tweak('write:/piston_api', 'ALLOWED', 'created a file')).ok);
  check('files: no probe output at all fails', !files([]).ok);
  check('files: canary content in the output fails even if the verdict says BLOCKED', !files(tweak(`read:${CANARIES[0]}`, 'BLOCKED', `leaked ${TOKEN}`)).ok);
  check('files: password hashes in stderr fail', !files(baseFiles, { stderr: 'root:$6$x$y:19000:0:99999:7:::' }).ok);
  check('files: Python and C++ run exactly the same probes', JSON.stringify(lib.fsProbePlan('python', CANARIES)) === JSON.stringify(lib.fsProbePlan('cpp', CANARIES)));
  check('files: C++ passes with the same answers', lib.evalFileAccess({ res: respond(stg({ stdout: probeLines(goodFileProbes('cpp')) })), lang: 'cpp', ctx: CTX }).ok);

  // environment
  const envRes = (pairs) => respond(stg({ stdout: pairs.map(([k, v]) => `CCENV\t${k}\t${v}`).join('\n') + '\n' }));
  const cleanEnv = [['PATH', '/usr/bin'], ['PISTON_LANGUAGE', 'python'], ['LC_CTYPE', 'C.UTF-8']];
  check('env: PATH, PISTON_LANGUAGE, LC_CTYPE pass (PISTON_LANGUAGE is Piston\'s own)', lib.evalEnvLeak({ res: envRes(cleanEnv), lang: 'python', ctx: CTX }).ok);
  check('env: another PISTON_ variable fails', !lib.evalEnvLeak({ res: envRes([...cleanEnv, ['PISTON_RUN_MEMORY_LIMIT', '1']]), lang: 'python', ctx: CTX }).ok);
  check('env: CANARY_ variable fails', !lib.evalEnvLeak({ res: envRes([...cleanEnv, ['CANARY_ENV_SECRET', 'x']]), lang: 'python', ctx: CTX }).ok);
  check('env: secret-looking name fails', !lib.evalEnvLeak({ res: envRes([...cleanEnv, ['JWT_SECRET', 'x']]), lang: 'python', ctx: CTX }).ok);
  check('env: canary token in an innocent variable fails', !lib.evalEnvLeak({ res: envRes([...cleanEnv, ['MOTD', TOKEN]]), lang: 'python', ctx: CTX }).ok);
  check('env: an empty dump fails', !lib.evalEnvLeak({ res: envRes([]), lang: 'python', ctx: CTX }).ok);
  check('env: the failure message never repeats the secret value', !lib.evalEnvLeak({ res: envRes([...cleanEnv, ['MOTD', TOKEN]]), lang: 'python', ctx: CTX }).detail.includes(TOKEN));

  // network
  const net = (lang, rows, run = {}, after = ALIVE) => lib.evalNetwork({ res: respond(stg({ stdout: probeLines(rows), ...run })), lang, ctx: CTX, after });
  check('network: socket() denied everywhere passes (python and c++)', net('python', goodNetProbes('python')).ok && net('cpp', goodNetProbes('cpp')).ok);
  check('network: a successful connect fails', !net('python', goodNetProbes('python').map((r) => (r[0] === 'tcp:172.17.0.1:22' ? [r[0], 'ALLOWED', 'phase=connect connected'] : r))).ok);
  check('network: an HTTP answer from the metadata service fails', !net('python', goodNetProbes('python').map((r) => (r[0].startsWith('http:') ? [r[0], 'ALLOWED', 'phase=http server answered HTTP 401'] : r))).ok);
  check('network: connect-level failure (ECONNREFUSED) fails: a route exists', !net('python', goodNetProbes('python').map((r) => (r[0] === 'tcp:1.1.1.1:443' ? [r[0], 'BLOCKED', 'phase=connect ConnectionRefusedError errno=111'] : r))).ok);
  // an empty network namespace (what current Piston does): socket() works, every connect() is ENETUNREACH
  const noRoute = (lang) => goodNetProbes(lang).map((r) => (r[0].startsWith('tcp:') ? [r[0], 'BLOCKED', lang === 'python' ? 'phase=connect OSError errno=101' : 'phase=connect errno=101 Network is unreachable'] : r));
  check('network: ENETUNREACH on every connect (empty network namespace) passes, python and c++', net('python', noRoute('python')).ok && net('cpp', noRoute('cpp')).ok);
  check('network: ENETUNREACH on all but one, which times out (ETIMEDOUT) fails', !net('python', noRoute('python').map((r) => (r[0] === 'tcp:1.1.1.1:443' ? [r[0], 'BLOCKED', 'phase=connect timeout errno=None'] : r))).ok);
  check('network: EHOSTUNREACH (113, a route exists) fails', !net('cpp', noRoute('cpp').map((r) => (r[0] === 'tcp:172.17.0.1:22' ? [r[0], 'BLOCKED', 'phase=connect errno=113 No route to host'] : r))).ok);
  check('network: a mix of socket() denied and ENETUNREACH passes', net('python', noRoute('python').map((r, i) => (i === 0 ? [r[0], 'BLOCKED', 'phase=socket PermissionError errno=13'] : r))).ok);
  check('network: errno 1010 is not errno 101', !net('python', noRoute('python').map((r) => (r[0] === 'tcp:1.1.1.1:443' ? [r[0], 'BLOCKED', 'phase=connect OSError errno=1010'] : r))).ok);
  check('network: DNS that resolves fails', !net('cpp', goodNetProbes('cpp').map((r) => (r[0].startsWith('dns:') ? [r[0], 'ALLOWED', 'phase=resolve resolved'] : r))).ok);
  check('network: a job killed by SIGSYS passes', lib.evalNetwork({ res: respond(stg({ status: 'SG', signal: 'SIGSYS', code: null })), lang: 'python', ctx: CTX, after: ALIVE }).ok);
  check('network: killed by timeout with no output fails (a hanging connect)', !lib.evalNetwork({ res: respond(stg({ status: 'TO', signal: 'SIGKILL', code: null })), lang: 'python', ctx: CTX, after: ALIVE }).ok);
  check('network: worst findings are listed first', /^NETWORK REACHABLE/.test(net('python', goodNetProbes('python').map((r) => (r[0] === 'tcp:1.1.1.1:443' ? [r[0], 'BLOCKED', 'phase=connect errno=111'] : r[0] === 'tcp:172.17.0.1:22' ? [r[0], 'ALLOWED', 'x'] : r))).detail));

  // limits cannot be raised per request
  const refused = (field) => ({ field, value: 1, res: { httpStatus: 400, elapsedMs: 3, bytes: 60, text: `{"message":"${field} cannot exceed the configured limit of 3000"}` } });
  check('limit-raise: all refused with 400 passes', lib.evalLimitRaise({ attempts: [refused('run_timeout'), refused('run_memory_limit')] }).ok);
  check('limit-raise: one accepted (HTTP 200) fails', !lib.evalLimitRaise({ attempts: [refused('run_timeout'), { field: 'run_cpu_time', value: 9, res: { httpStatus: 200, elapsedMs: 3, bytes: 9, text: '{}' } }] }).ok);
  check('limit-raise: HTTP 500 is not a clean refusal', !lib.evalLimitRaise({ attempts: [{ field: 'run_timeout', value: 9, res: { httpStatus: 500, elapsedMs: 3, bytes: 9, text: 'boom' } }] }).ok);
  check('limit-raise: a 400 for another reason is not a refusal of the limit', !lib.evalLimitRaise({ attempts: [{ field: 'run_timeout', value: 9, res: { httpStatus: 400, elapsedMs: 3, bytes: 9, text: '{"message":"bad json"}' } }] }).ok);
  check('limit-raise: no attempts is an error, not a pass', !lib.evalLimitRaise({ attempts: [] }).ok);

  // sanity
  check('sanity: hello world passes, wrong output fails, crash fails', lib.evalSanity({ res: respond(stg({ stdout: `${lib.HELLO_MARKER}\n` })), lang: 'python', ctx: CTX }).ok && !lib.evalSanity({ res: respond(stg({ stdout: 'nope' })), lang: 'python', ctx: CTX }).ok && !lib.evalSanity({ res: respond(stg({ code: 1, status: 'RE' })), lang: 'python', ctx: CTX }).ok);
});

// =============================================================================
await section('4. the attack programs: valid code that reports what the checks expect', () => {
  const tmp = fs.mkdtempSync(path.join(fs.existsSync('/tmp') ? '/tmp' : '.', 'cc-selftest-'));
  fs.chmodSync(tmp, 0o755);
  try {
    for (const scenario of PROGRAM_SCENARIOS) {
      for (const lang of ['python', 'cpp']) {
        const src = buildProgram(scenario, lang, { canaryPaths: CANARIES });
        check(`${scenario}/${lang}: marker on the first line identifies the scenario`, scenarioOfSource(src) === scenario);
      }
    }
    check('canary paths with shell/quote characters are rejected', (() => { try { buildProgram('file-access', 'python', { canaryPaths: ['/x"; rm -rf /'] }); return false; } catch { return true; } })());

    // The network programs probe the targets the checks expect (they are not executed here: they would dial out).
    for (const lang of ['python', 'cpp']) {
      const src = buildProgram('network', lang);
      for (const step of lib.netProbePlan(lang)) {
        const needle = step.kind === 'dns' ? lib.NET_TARGETS.dns : step.id.replace(/^(tcp|http):/, '').split(':')[0];
        check(`network/${lang}: program probes ${step.id}`, src.includes(needle));
      }
    }

    // Static validity.
    if (has('python3')) {
      let bad = '';
      for (const scenario of PROGRAM_SCENARIOS) {
        const file = path.join(tmp, `${scenario}.py`);
        fs.writeFileSync(file, buildProgram(scenario, 'python', { canaryPaths: CANARIES }));
        const r = spawnSync('python3', ['-m', 'py_compile', file], { encoding: 'utf8' });
        if (r.status !== 0) bad += `${scenario}: ${r.stderr}\n`;
      }
      check('python3 compiles every Python program', bad === '', bad);
    } else skip('python3 not found, Python programs not compiled');
    if (has('g++')) {
      let bad = '';
      for (const scenario of PROGRAM_SCENARIOS) {
        const file = path.join(tmp, `${scenario}.cpp`);
        fs.writeFileSync(file, buildProgram(scenario, 'cpp', { canaryPaths: CANARIES }));
        // -O2 -c (not -fsyntax-only): some warnings, such as -Wformat-truncation, only appear when the optimizer runs.
        const r = spawnSync('g++', ['-std=c++11', '-Wall', '-Wextra', '-O2', '-c', '-o', '/dev/null', file], { encoding: 'utf8' });
        if (r.status !== 0 || r.stderr.trim() !== '') bad += `${scenario}: ${r.stderr}\n`;
      }
      check('g++ -std=c++11 -Wall -Wextra -O2 accepts every C++ program without a warning', bad === '', bad);
    } else skip('g++ not found, C++ programs not compiled');

    // Run the harmless programs for real, as an unprivileged user, and check that every
    // probe the plan expects is actually reported (a probe nobody prints could never FAIL).
    const root = typeof process.getuid === 'function' && process.getuid() === 0;
    const dropPrivileges = root ? (has('setpriv') ? ['setpriv', '--reuid=65534', '--regid=65534', '--clear-groups'] : null) : [];
    if (dropPrivileges === null) {
      skip('running as root without setpriv: the file probes are not executed locally');
    } else if (!has('python3') || !has('g++')) {
      skip('python3 or g++ missing: the programs are not executed locally');
    } else {
      const work = path.join(tmp, 'work');
      fs.mkdirSync(work);
      if (root) fs.chownSync(work, 65534, 65534);
      const runIt = (argv, env) => {
        const full = dropPrivileges.length > 0 ? [...dropPrivileges, ...argv] : argv;
        const r = spawnSync('env', ['-i', ...Object.entries(env).map(([k, v]) => `${k}=${v}`), ...full], { cwd: work, encoding: 'utf8', timeout: 30_000 });
        return stg({ stdout: r.stdout ?? '', stderr: r.stderr ?? '', code: r.status, signal: r.signal });
      };
      const cleanEnv = { PATH: process.env.PATH ?? '/usr/bin:/bin', PISTON_LANGUAGE: 'x' };
      const localCtx = { ...CTX, canaryPaths: ['/nonexistent/cc-canary-a', '/nonexistent/cc-canary-b'] };
      for (const lang of ['python', 'cpp']) {
        const run = (scenario) => {
          const src = path.join(tmp, `local-${scenario}.${lang === 'python' ? 'py' : 'cpp'}`);
          fs.writeFileSync(src, buildProgram(scenario, lang, { canaryPaths: localCtx.canaryPaths }));
          fs.chmodSync(src, 0o644);
          if (lang === 'python') return runIt(['python3', src], cleanEnv);
          const bin = path.join(tmp, `local-${scenario}.bin`);
          const c = spawnSync('g++', ['-std=c++11', '-o', bin, src], { encoding: 'utf8' });
          if (c.status !== 0) return stg({ code: 1, stderr: c.stderr });
          fs.chmodSync(bin, 0o755);
          return runIt([bin], cleanEnv);
        };
        const sanityRun = run('sanity');
        check(`local run ${lang}: hello world prints the marker`, sanityRun.stdout.includes(lib.HELLO_MARKER), sanityRun.stderr);
        const envRun = run('env-leak');
        check(`local run ${lang}: env dump is parseable and judged clean`, lib.evalEnvLeak({ res: respond(envRun), lang, ctx: localCtx }).ok, JSON.stringify(envRun).slice(0, 300));
        const fileRun = run('file-access');
        const reported = new Set(lib.parseProbeLines(fileRun.stdout).keys());
        const planned = lib.fsProbePlan(lang, localCtx.canaryPaths).map((s) => s.id);
        const missing = planned.filter((id) => !reported.has(id));
        const extra = [...reported].filter((id) => !planned.includes(id));
        check(`local run ${lang}: the file-access program reports exactly the probes the plan expects (${planned.length})`, missing.length === 0 && extra.length === 0, `missing: ${missing.join(', ')}  unexpected: ${extra.join(', ')}  stderr: ${fileRun.stderr.slice(0, 200)}`);
        // As an unprivileged user the dangerous probes must really be blocked on a normal machine.
        const verdicts = lib.parseProbeLines(fileRun.stdout);
        check(`local run ${lang}: /etc/shadow, /root listing and writes to /etc are blocked for an unprivileged user`, ['read:/etc/shadow', 'list:/root', 'write:/etc', 'write:/usr'].every((id) => verdicts.get(id)?.verdict === 'BLOCKED'));
        check(`local run ${lang}: both control probes succeed (the probe code works)`, verdicts.get('control:read:/etc/passwd')?.verdict === 'ALLOWED' && verdicts.get('control:write:cwd')?.verdict === 'ALLOWED');
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// =============================================================================
// Scaled-down limits so a run takes about a second.
const SCALED_LIMITS = { ...lib.DEFAULT_LIMITS, runTimeoutMs: 300, compileTimeoutMs: 600 };
const SCALED_TH = { wallSlackMs: 700, apiRecoveryMs: 600, apiPollIntervalMs: 50 };
const MOCK_BASE = { limits: SCALED_LIMITS, canaryToken: TOKEN, canaryPaths: CANARIES, unsafeLoopMs: 4000, apiDownMs: 1500 };

async function harness(mockOptions, runOptions = {}) {
  const mock = await startMock({ ...MOCK_BASE, ...mockOptions });
  try {
    return await runAll({ pistonUrl: mock.url, limits: SCALED_LIMITS, thresholds: SCALED_TH, canaryToken: TOKEN, canaryPaths: CANARIES, ...runOptions });
  } finally {
    await mock.close();
  }
}
const failing = (rows) => rows.filter((r) => !r.ok).map((r) => `${r.name}/${r.lang}`).sort();
/** A loopback port that was just free and has nothing on it. (Not port 1: fetch refuses "bad ports" before it connects.) */
async function closedPort() {
  const probe = http.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

await section('5. whole harness against the mock, MODE=safe (a correctly configured Piston)', async () => {
  for (const [label, opts] of [
    ['default shapes (TO/SG/RE/OL, errno-style network denial)', {}],
    ['network denial by SIGSYS kill', { netStyle: 'sigsys' }],
    ['network denial by an empty network namespace (ENETUNREACH)', { netStyle: 'netns' }],
    ['older Piston without a `status` field', { legacyShape: true }],
  ]) {
    const { rows, summary } = await harness({ mode: 'safe', ...opts });
    check(`safe, ${label}: 19 checks, all PASS`, summary.ok && summary.total === 19, rows.filter((r) => !r.ok).map((r) => `${r.name}/${r.lang}: ${r.detail}`).join('\n'));
  }
});

await section('6. whole harness against the mock, MODE=unsafe (everything wrong at once)', async () => {
  const { rows } = await harness({ mode: 'unsafe' });
  const expected = [];
  for (const scenario of lib.SCENARIOS) {
    if (scenario === 'sanity') continue;
    if (scenario === 'limit-raise') expected.push('limit-raise/any');
    else for (const label of ['python', 'c++']) expected.push(`${scenario}/${label}`);
  }
  const got = failing(rows);
  check('unsafe: exactly every attack scenario fails, in both languages', JSON.stringify(got) === JSON.stringify(expected.sort()), `expected ${expected.sort().join(', ')}\n     got ${got.join(', ')}`);
  check('unsafe: the sanity check still passes (the harness blames the right thing)', rows.filter((r) => r.name === 'sanity').every((r) => r.ok));
  const detail = (name) => rows.filter((r) => r.name === name).map((r) => r.detail).join(' | ');
  check('unsafe: env-leak names PISTON_RUN_MEMORY_LIMIT', /PISTON_RUN_MEMORY_LIMIT/.test(detail('env-leak')));
  check('unsafe: file-access reports the canary leak', /canary/.test(detail('file-access')));
  check('unsafe: network names the reachable host', /NETWORK REACHABLE/.test(detail('network')));
});

await section('7. one flaw at a time: each must fail its own scenario and nothing else', async () => {
  const DETAIL = {
    'loop-runs-long': /no response within/,
    'fork-clean-exit': /not contained/,
    'api-dies-after-fork': /did not answer GET \/api\/v2\/runtimes/,
    'output-unbounded': /output was not cut off/,
    'stderr-unbounded': /stderr was not cut off/,
    'file-read': /read:\/etc\/shadow: ALLOWED/,
    'canary-leak': /LEAK in output: canary token/,
    'root-listable': /list:\/root: ALLOWED/,
    'home-nonempty': /list:\/home: listing succeeded and is not empty/,
    'write-etc': /write:\/etc: ALLOWED/,
    'docker-sock': /stat:\/var\/run\/docker\.sock: ALLOWED/,
    'proc-environ': /scan:\/proc\/\*\/environ: ALLOWED/,
    'proc-root': /root:\/proc\/1\/root: ALLOWED/,
    'probe-broken': /control probe failed/,
    'env-leak': /PISTON_RUN_MEMORY_LIMIT is visible/,
    'env-secret': /AWS_SECRET_ACCESS_KEY looks like a secret/,
    'env-value-leak': /value of MOTD contains canary token/,
    'net-connect': /NETWORK REACHABLE tcp:172\.17\.0\.1:22/,
    'net-soft': /connect\(\) failed for a reason other than "no route"/,
    'metadata-reachable': /NETWORK REACHABLE (http|tcp):169\.254\.169\.254/,
    'dns-works': /NETWORK REACHABLE dns:example\.com/,
    'mem-survives': /allocated 2 GB and finished/,
    'mem-timeout': /timed out instead of being stopped by the memory limit/,
    'limits-raisable': /ACCEPTED/,
    'hello-broken': /unexpected output/,
  };
  check('every flaw in the mock has an expectation in this test', JSON.stringify(Object.keys(FLAWS).sort()) === JSON.stringify(Object.keys(DETAIL).sort()));
  for (const [flaw, meta] of Object.entries(FLAWS)) {
    const { rows } = await harness({ mode: 'safe', flaws: [flaw] }, { only: [meta.scenario, 'sanity'] });
    const langs = meta.scenario === 'limit-raise' ? ['any'] : (meta.langs ?? ['python', 'cpp']).map((l) => lib.LANGS[l].label);
    const expected = langs.map((l) => `${meta.scenario}/${l}`).sort();
    const got = failing(rows);
    const detail = rows.filter((r) => !r.ok).map((r) => r.detail).join(' | ');
    check(`flaw "${flaw}" (${meta.what}) fails exactly ${expected.join(', ')}`, JSON.stringify(got) === JSON.stringify(expected), `got failures: ${got.join(', ') || 'none'}\n${detail}`);
    check(`flaw "${flaw}": the message says why`, DETAIL[flaw]?.test(detail), detail);
  }
});

await section('8. the command line: exit status and output', async () => {
  const dir = fs.mkdtempSync(path.join(fs.existsSync('/tmp') ? '/tmp' : '.', 'cc-selftest-cli-'));
  try {
    const limitsFile = path.join(dir, 'limits.env');
    fs.writeFileSync(limitsFile, fs.readFileSync(path.join(DEPLOY, 'piston', 'limits.env'), 'utf8').replace('PISTON_RUN_TIMEOUT=3000', 'PISTON_RUN_TIMEOUT=300').replace('PISTON_COMPILE_TIMEOUT=10000', 'PISTON_COMPILE_TIMEOUT=600'));
    const cli = (url, extraEnv = {}) =>
      new Promise((resolve) => {
        const child = spawn(process.execPath, [path.join(HERE, 'run.mjs')], {
          env: { ...process.env, PISTON_URL: url, LIMITS_ENV_FILE: limitsFile, CANARY_PATH: CANARIES.join(':'), CANARY_TOKEN: TOKEN, WALL_SLACK_MS: '700', API_RECOVERY_MS: '600', ...extraEnv },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let out = '';
        let err = '';
        child.stdout.on('data', (d) => (out += d));
        child.stderr.on('data', (d) => (err += d));
        child.on('close', (code) => resolve({ code, out, err }));
      });

    let mock = await startMock({ ...MOCK_BASE, mode: 'safe' });
    let r = await cli(mock.url);
    await mock.close();
    check('CLI against a safe Piston: exit 0, "RESULT: PASS", a table with PASS rows', r.code === 0 && /RESULT: PASS/.test(r.out) && /infinite-loop\s+python\s+PASS/.test(r.out), `exit ${r.code}\n${r.out.slice(-800)}${r.err}`);

    mock = await startMock({ ...MOCK_BASE, mode: 'unsafe' });
    r = await cli(mock.url);
    await mock.close();
    check('CLI against an unsafe Piston: exit 1, "RESULT: FAIL", FAIL rows', r.code === 1 && /RESULT: FAIL/.test(r.out) && /env-leak\s+python\s+FAIL/.test(r.out) && /sanity\s+python\s+PASS/.test(r.out), `exit ${r.code}\n${r.out.slice(-800)}${r.err}`);

    mock = await startMock({ ...MOCK_BASE, mode: 'safe' });
    r = await cli(mock.url, { ONLY: 'sanity,network', LANGS: 'python' });
    await mock.close();
    check('CLI: ONLY and LANGS select scenarios (2 checks)', r.code === 0 && /2 checks: 2 PASS/.test(r.out), r.out.slice(-400));

    r = await cli(`http://127.0.0.1:${await closedPort()}`);
    check('CLI against nothing: exit 2 and a clear message', r.code === 2 && /does not answer/.test(r.err), `exit ${r.code} ${r.err}`);
    r = await cli('http://203.0.113.9:2000');
    check('CLI against a machine that is not loopback: refused up front (exit 2), nothing sent', r.code === 2 && /refusing to run/.test(r.err) && !/Piston escape tests/.test(r.out), `exit ${r.code} ${r.err}`);
    r = await cli('http://127.0.0.1@203.0.113.9:2000');
    check('CLI: credentials in the URL cannot disguise a remote host', r.code === 2 && /user name or password/.test(r.err), `exit ${r.code} ${r.err}`);
    check('targetProblem: loopback forms accepted, remote refused unless ALLOW_REMOTE', targetProblem('http://127.0.0.1:2000') === null && targetProblem('http://localhost:2000') === null && targetProblem('http://[::1]:2000') === null && targetProblem('http://127.5.5.5:2000') === null && targetProblem('http://10.0.0.5:2000') !== null && targetProblem('http://10.0.0.5:2000', true) === null && targetProblem('http://127.0.0.1.evil.example:2000') !== null && targetProblem('ftp://127.0.0.1') !== null && targetProblem('not a url') !== null);
    r = await cli(mock.url, { ONLY: 'not-a-scenario' });
    check('CLI: an unknown scenario name is a usage error (exit 2)', r.code === 2 && /Unknown ONLY\/LANGS/.test(r.err), `exit ${r.code} ${r.err}`);
    r = await cli(mock.url, { LIMITS_ENV_FILE: path.join(dir, 'missing.env') });
    check('CLI: an unreadable LIMITS_ENV_FILE is an error, not a silent fallback (exit 2)', r.code === 2 && /Cannot read LIMITS_ENV_FILE/.test(r.err), `exit ${r.code} ${r.err}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await section('9. HTTP helper edge cases', async () => {
  const big = http.createServer((req, res) => {
    if (req.url === '/big') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(Buffer.alloc(3 * lib.MIB, 0x41));
    } else if (req.url === '/slow') {
      setTimeout(() => res.end('{}'), 3000).unref();
    } else {
      res.writeHead(200);
      res.end('not json');
    }
  });
  await new Promise((resolve) => big.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${big.address().port}`;
  let r = await httpJson(`${base}/big`, { deadlineMs: 5000, maxBytes: lib.MIB });
  check('a body over the read cap is cut off and flagged truncated', r.truncated === true && r.bytes > lib.MIB && r.text === '');
  r = await httpJson(`${base}/slow`, { deadlineMs: 150, maxBytes: lib.MIB });
  check('a slow answer ends at the client deadline with error "deadline"', r.error === 'deadline' && r.elapsedMs < 1500);
  r = await httpJson(`${base}/text`, { deadlineMs: 2000, maxBytes: lib.MIB });
  check('a non-JSON body is returned as text with json undefined', r.httpStatus === 200 && r.json === undefined && r.text === 'not json');
  big.closeAllConnections();
  await new Promise((resolve) => big.close(resolve));
  const closed = await closedPort();
  r = await httpJson(`http://127.0.0.1:${closed}/x`, { deadlineMs: 2000, maxBytes: lib.MIB });
  check('a refused connection is reported as ECONNREFUSED', r.error === 'ECONNREFUSED', JSON.stringify(r));
  const w = await waitForApi(`http://127.0.0.1:${closed}`, { withinMs: 200, intervalMs: 50, probeTimeoutMs: 100 });
  check('waitForApi gives up with alive=false when nothing answers', w.alive === false);
  const mock = await startMock({ ...MOCK_BASE, mode: 'safe' });
  check('waitForApi succeeds against a live API', (await waitForApi(mock.url, { withinMs: 500, intervalMs: 50, probeTimeoutMs: 500 })).alive === true);
  await mock.close();
});

await section('10. guard rails on the shell scripts', () => {
  const read = (rel) => fs.readFileSync(path.join(DEPLOY, rel), 'utf8');
  const code = (text) => text.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
  const prod = read('piston/run-piston.sh');
  const test = read('escape-tests/run-in-docker.sh');
  check('run-piston.sh publishes on loopback only', /BIND_ADDR="127\.0\.0\.1"/.test(prod) && !/0\.0\.0\.0/.test(code(prod)) && !/-p\s+"?\$?\{?HOST_PORT/.test(code(prod)));
  check('run-piston.sh uses --privileged, --env-file, memory, pids and cpu limits', ['--privileged', '--env-file', '--memory=', '--memory-swap=', '--pids-limit=', '--cpus='].every((f) => code(prod).includes(f)));
  check('run-piston.sh can be sourced without running (main guard)', /BASH_SOURCE\[0\]}" == "\$0"/.test(prod));
  check('run-in-docker.sh takes its settings from run-piston.sh and starts no container of its own', /^source "\$PISTON_SH"/m.test(code(test)) && !/^\s*docker\s+(container\s+)?(run|create|start|rm|stop|kill|restart|update)\b/m.test(code(test)));
  check('run-in-docker.sh removes its canary files through a trap, and drops ALLOW_REMOTE for run.mjs', /^\s*trap cleanup EXIT/m.test(code(test)) && /env -u ALLOW_REMOTE/.test(code(test)));
  const tunable = (name) => new RegExp(`^${name}="([^"]*)"`, 'm').exec(prod)?.[1];
  check('run-piston.sh installs the same python and gcc versions the harness tests', tunable('PYTHON_VERSION') === lib.LANGS.python.version && tunable('GCC_VERSION') === lib.LANGS.cpp.version, `${tunable('PYTHON_VERSION')} ${tunable('GCC_VERSION')}`);
  if (has('bash')) {
    for (const rel of ['piston/run-piston.sh', 'escape-tests/run-in-docker.sh']) {
      const r = spawnSync('bash', ['-n', path.join(DEPLOY, rel)], { encoding: 'utf8' });
      check(`bash -n ${rel}`, r.status === 0, r.stderr);
    }
  } else skip('bash not found');
  if (has('shellcheck')) {
    const r = spawnSync('shellcheck', ['-x', path.join(DEPLOY, 'piston/run-piston.sh'), path.join(DEPLOY, 'escape-tests/run-in-docker.sh')], { encoding: 'utf8' });
    check('shellcheck is clean on both scripts', r.status === 0, r.stdout + r.stderr);
  } else skip('shellcheck not installed');
});

// =============================================================================
await section('11. run-in-docker.sh, driven by a fake docker and the mock Piston', async () => {
  if (!has('bash') || !has('curl')) {
    skip('bash or curl not found');
    return;
  }
  const dir = fs.mkdtempSync(path.join(fs.existsSync('/tmp') ? '/tmp' : '.', 'cc-selftest-rid-'));
  try {
    const port = await closedPort();
    // A private copy of the files the script reads, so the copy can use short timeouts and the
    // mock's port without touching the real files. The scripts find each other relative to themselves.
    const copy = (rel) => path.join(dir, 'deploy', rel);
    for (const rel of ['piston/run-piston.sh', 'piston/limits.env', 'escape-tests/run-in-docker.sh', 'escape-tests/run.mjs', 'escape-tests/lib.mjs', 'escape-tests/programs.mjs']) {
      fs.mkdirSync(path.dirname(copy(rel)), { recursive: true });
      fs.copyFileSync(path.join(DEPLOY, rel), copy(rel));
    }
    fs.writeFileSync(copy('piston/limits.env'), fs.readFileSync(copy('piston/limits.env'), 'utf8').replace('PISTON_RUN_TIMEOUT=3000', 'PISTON_RUN_TIMEOUT=300').replace('PISTON_COMPILE_TIMEOUT=10000', 'PISTON_COMPILE_TIMEOUT=600'));
    const original = fs.readFileSync(copy('piston/run-piston.sh'), 'utf8');
    const withPort = original.replace('HOST_PORT="2000"', `HOST_PORT="${port}"`);
    check('test setup: the copy of run-piston.sh got the mock port', withPort !== original);
    fs.writeFileSync(copy('piston/run-piston.sh'), withPort);

    // What `docker inspect` must say for the container to match run-piston.sh, computed from the settings in the script.
    const tun = (name) => new RegExp(`^${name}="([^"]*)"`, 'm').exec(withPort)?.[1];
    const toBytes = (s) => Number(/^\d+/.exec(s)[0]) * 1024 ** ({ k: 1, m: 2, g: 3 }[/[kmg]$/i.exec(s)[0].toLowerCase()]);
    const baseContainer = {
      name: tun('CONTAINER_NAME'),
      status: 'running',
      privileged: true,
      memory: toBytes(tun('CONTAINER_MEMORY')),
      memorySwap: toBytes(tun('CONTAINER_MEMORY_SWAP')),
      pidsLimit: Number(tun('CONTAINER_PIDS_LIMIT')),
      nanoCpus: Math.round(Number(tun('CONTAINER_CPUS')) * 1e9),
      restartPolicy: tun('RESTART_POLICY'),
      bindings: [`2000/tcp -> ${tun('BIND_ADDR')}:${port}`],
      logConfig: `json-file ${tun('LOG_MAX_SIZE')} x${tun('LOG_MAX_FILE')}`,
      env: fs.readFileSync(copy('piston/limits.env'), 'utf8').split('\n').filter((l) => l !== '' && !l.startsWith('#')),
      startedAt: '2026-01-01T00:00:00.000000000Z',
      restartedStartedAt: '2026-01-01T00:05:00.000000000Z',
      restartCount: 0,
      restartAfterMarkReads: null,
      markReads: 0,
    };
    check('test setup: the container settings were read from run-piston.sh', baseContainer.name === 'piston-api' && baseContainer.memory > 0 && baseContainer.pidsLimit > 0 && baseContainer.nanoCpus > 0 && baseContainer.env.length === 13, JSON.stringify(baseContainer).slice(0, 300));

    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'docker'), `#!/bin/sh\nexec "${process.execPath}" "${path.join(HERE, 'fake-docker.mjs')}" "$@"\n`, { mode: 0o755 });
    const statePath = path.join(dir, 'state.json');
    const callsPath = path.join(dir, 'calls.log');

    /** Runs the copy of run-in-docker.sh once and returns what happened. */
    async function drive({ container = {}, state = {}, mock = { mode: 'safe' }, env = {}, args = ['--yes'], url } = {}) {
      fs.writeFileSync(statePath, JSON.stringify({ callsLog: callsPath, daemonDown: false, recentJobs: 0, failPlant: false, files: {}, container: { ...baseContainer, ...container }, ...state }));
      fs.rmSync(callsPath, { force: true });
      const server = mock ? await startMock({ ...MOCK_BASE, port, ...mock }) : null;
      try {
        const childEnv = { ...process.env };
        for (const key of ['ALLOW_REMOTE', 'PISTON_CONTAINER', 'ONLY', 'LANGS', 'VERBOSE', 'LIMITS_ENV_FILE', 'CANARY_PATH', 'CANARY_TOKEN']) delete childEnv[key];
        const result = await new Promise((resolve) => {
          const child = spawn('bash', [copy('escape-tests/run-in-docker.sh'), ...args], {
            cwd: dir,
            env: { ...childEnv, PATH: `${bin}${path.delimiter}${process.env.PATH}`, FAKE_DOCKER_STATE: statePath, PISTON_URL: url ?? `http://127.0.0.1:${port}`, WALL_SLACK_MS: '700', API_RECOVERY_MS: '600', ...env },
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          let out = '';
          let err = '';
          child.stdout.on('data', (d) => (out += d));
          child.stderr.on('data', (d) => (err += d));
          child.on('close', (code) => resolve({ code, out, err }));
        });
        const calls = fs.existsSync(callsPath) ? fs.readFileSync(callsPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
        const files = JSON.parse(fs.readFileSync(statePath, 'utf8')).files;
        return { ...result, text: `${result.out}${result.err}`, calls, files };
      } finally {
        if (server) await server.close();
      }
    }
    const tail = (r) => `exit ${r.code}\n${r.text.slice(-1500)}`;
    const unknownCalls = (r) => r.calls.filter((c) => c.unsupported).map((c) => c.args.join(' '));
    const execKinds = (r) => {
      const kinds = { plant: 0, stat: 0, remove: 0, other: 0 };
      for (const c of r.calls.filter((x) => x.args[0] === 'exec')) {
        if (c.args.some((a) => a.includes('cat >'))) kinds.plant++;
        else if (c.args.includes('stat')) kinds.stat++;
        else if (c.args.includes('rm')) kinds.remove++;
        else kinds.other++;
      }
      return kinds;
    };
    const QUICK = { ONLY: 'sanity,env-leak' }; // enough of the suite for scenarios that are about the script

    // --- a correctly configured Piston ---------------------------------------------------
    let r = await drive();
    check('safe Piston: exit 0, "RESULT: PASS", 19 checks passed', r.code === 0 && /RESULT: PASS: every attack was contained and the container held\./.test(r.text) && /19 checks: 19 PASS, 0 FAIL/.test(r.text), tail(r));
    check('safe Piston: the warning comes first and says what the tests do and when to run them', /HOSTILE programs/.test(r.text) && /fork bomb/.test(r.text) && /NOBODY IS USING THE SITE/.test(r.text) && r.text.indexOf('HOSTILE programs') < r.text.indexOf('docker inspect facts'));
    check('safe Piston: the docker inspect table shows memory, pids and cpus, all ok', ['HostConfig.Memory (bytes)', 'HostConfig.PidsLimit', 'HostConfig.NanoCpus'].every((k) => new RegExp(`${k.replace(/[().]/g, '\\$&')}\\s+\\d+\\s+ok`).test(r.text)) && !/MISMATCH/.test(r.text), tail(r));
    check('safe Piston: only docker commands that read, plus the canary files', unknownCalls(r).length === 0 && r.calls.every((c) => ['info', 'inspect', 'container', 'exec', 'logs'].includes(c.args[0])), unknownCalls(r).join('\n'));
    const kinds = execKinds(r);
    check('safe Piston: two canary files planted and checked, removed again, none left behind', kinds.plant === 2 && kinds.stat === 2 && kinds.remove === 2 && kinds.other === 0 && Object.keys(r.files).length === 0, JSON.stringify(kinds) + JSON.stringify(r.files));

    // --- a Piston with every flaw -------------------------------------------------------
    r = await drive({ mock: { mode: 'unsafe' } });
    check('unsafe Piston: exit 1, "RESULT: FAIL", the failed checks are named', r.code === 1 && /RESULT: FAIL/.test(r.text) && /failed checks:.*env-leak \(python\)/.test(r.text) && /file-access \(c\+\+\)/.test(r.text), tail(r));
    check('unsafe Piston: the canary files are removed even then', Object.keys(r.files).length === 0);

    // --- cannot run: nothing hostile may be sent -----------------------------------------
    r = await drive({ mock: null, container: { status: 'exited' } });
    check('container not running: exit 2, says how to start it, no exec', r.code === 2 && /is exited, not running/.test(r.text) && /docker start piston-api/.test(r.text) && r.calls.every((c) => c.args[0] !== 'exec'), tail(r));
    r = await drive({ mock: null, container: { name: 'something-else' } });
    check('no such container: exit 2 and a pointer to run-piston.sh', r.code === 2 && /no container named 'piston-api'/.test(r.text) && /run-piston\.sh/.test(r.text), tail(r));
    r = await drive({ mock: null, args: ['--yes', '--container', 'other'] });
    check('--container NAME is honoured', r.code === 2 && /no container named 'other'/.test(r.text), tail(r));
    r = await drive({ mock: null, state: { daemonDown: true } });
    check('Docker daemon down: exit 2 with a clear message', r.code === 2 && /cannot talk to the Docker daemon/.test(r.text), tail(r));
    r = await drive({ args: [] });
    check('no terminal and no --yes: exit 2, asks for --yes, nothing planted', r.code === 2 && /no terminal to ask on/.test(r.text) && /--yes/.test(r.text) && execKinds(r).plant === 0, tail(r));
    r = await drive({ mock: null, args: ['--help'] });
    check('--help prints the usage and exits 0 without touching docker', r.code === 0 && /usage: run-in-docker\.sh/.test(r.text) && r.calls.length === 0, tail(r));
    r = await drive({ mock: null, args: ['--bogus'] });
    check('an unknown argument is a usage error (exit 2)', r.code === 2 && /unknown argument/.test(r.text), tail(r));

    for (const url of ['http://203.0.113.9:2000', 'http://127.0.0.1@203.0.113.9:2000', 'http://127.0.0.1.evil.example:2000', 'http://localhost.evil.example:2000', 'https://127.0.0.1:2000', 'http://[::1]x@evil.example']) {
      r = await drive({ mock: null, url, env: { ALLOW_REMOTE: '1' } });
      check(`PISTON_URL=${url}: refused (exit 2) before docker is called, even with ALLOW_REMOTE=1`, r.code === 2 && /not a loopback address/.test(r.text) && r.calls.length === 0, tail(r));
    }
    r = await drive({ mock: null, url: `http://127.0.0.1:${port + 1}` });
    check('PISTON_URL on a port the container does not publish: exit 2 (its limits would belong to another Piston)', r.code === 2 && /is not the port that container 'piston-api' publishes/.test(r.text), tail(r));
    r = await drive({ mock: { mode: 'safe', noPackages: true } });
    check('packages missing: exit 2 and the exact install commands for python and gcc', r.code === 2 && r.text.includes(`curl -fsS -X POST http://127.0.0.1:${port}/api/v2/packages -H 'Content-Type: application/json' -d '{"language":"python","version":"3.10.0"}'`) && r.text.includes(`-d '{"language":"gcc","version":"10.2.0"}'`) && execKinds(r).plant === 0, tail(r));
    r = await drive({ mock: null, url: `http://127.0.0.1:${port}/` });
    check('a trailing slash on PISTON_URL is accepted (then it stops: nothing listens)', r.code === 2 && /does not answer/.test(r.text), tail(r));
    r = await drive({ container: { memory: 0 } });
    check('no memory limit on the container: exit 2, nothing planted or sent', r.code === 2 && /no memory limit/.test(r.text) && execKinds(r).plant === 0 && !/Piston escape tests ->/.test(r.text), tail(r));
    r = await drive({ container: { pidsLimit: null } });
    check('no pids limit on the container: exit 2', r.code === 2 && /no pids limit/.test(r.text) && execKinds(r).plant === 0, tail(r));
    r = await drive({ env: { ONLY: 'not-a-scenario' } });
    check('run.mjs refuses to run (exit 2): the script says so, exits 2 and still removes the canary files', r.code === 2 && /run\.mjs could not run the tests/.test(r.text) && execKinds(r).remove === 2 && Object.keys(r.files).length === 0, tail(r));

    // --- runs, but the result is FAIL --------------------------------------------------------
    r = await drive({ env: QUICK, container: { memory: 1024 * 1024 * 1024, privileged: false, bindings: [`2000/tcp -> 0.0.0.0:${port}`] } });
    check('container differs from run-piston.sh: MISMATCH lines, exit 1 even though the suite passes', r.code === 1 && /HostConfig\.Memory \(bytes\)\s+\d+\s+MISMATCH/.test(r.text) && /HostConfig\.Privileged\s+false\s+MISMATCH/.test(r.text) && /Published port binding\s+.*MISMATCH/.test(r.text) && /container limits match run-piston\.sh:\s+NO/.test(r.text) && /4 checks: 4 PASS/.test(r.text) && /RESULT: FAIL/.test(r.text), tail(r));
    r = await drive({ env: QUICK, container: { env: baseContainer.env.filter((l) => !l.startsWith('PISTON_DISABLE_NETWORKING')) } });
    check('a limits.env line missing from the container: reported and exit 1', r.code === 1 && /limits\.env line not in container env: PISTON_DISABLE_NETWORKING=true/.test(r.text), tail(r));
    r = await drive({ env: QUICK, container: { restartAfterMarkReads: 1 } });
    check('container restarted during the tests: exit 1 and says so', r.code === 1 && /was restarted during the tests/.test(r.text) && /still running, not restarted, API up:\s+NO/.test(r.text), tail(r));

    // --- runs and passes, with a warning ---------------------------------------------------------
    r = await drive({ env: QUICK, state: { failPlant: true } });
    check('canary planting fails: warns, runs without the canary reads, still exit 0', r.code === 0 && /could not plant a canary file at \/root\/cc-canary\.txt/.test(r.text) && /0 canary file\(s\) planted/.test(r.text) && /RESULT: PASS/.test(r.text) && /CANARY_PATH is not set/.test(r.text), tail(r));
    r = await drive({ env: QUICK, state: { recentJobs: 3 } });
    check('Piston log shows recent jobs: a warning about real users, the run goes on', r.code === 0 && /WARNING: Piston ran 3 job\(s\) in the last 5 minutes/.test(r.text), tail(r));

    // --- the helpers it borrows from run-piston.sh -------------------------------------------------
    const helper = spawnSync('bash', ['-c', `source "${copy('piston/run-piston.sh')}"; printf '%s %s %s %s' "$(to_bytes 640m)" "$(to_bytes 1g)" "$(to_bytes 512k)" "$(to_bytes 7)"`], { encoding: 'utf8' });
    check('run-piston.sh can be sourced (main does not run) and to_bytes converts 640m, 1g, 512k, 7', helper.status === 0 && helper.stdout === `${640 * 1024 * 1024} ${1024 ** 3} ${512 * 1024} 7`, `${helper.stdout} ${helper.stderr}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`\nselftest: ${total} checks, ${failed} failed`);
if (failed > 0) console.log('selftest FAILED');
else console.log('selftest PASSED');
process.exit(failed > 0 ? 1 : 0);
