#!/usr/bin/env node
// =============================================================================
// A fake `docker` command, used only by selftest.mjs to drive run-in-docker.sh on
// a machine that has no Docker. selftest.mjs puts a tiny `docker` wrapper that
// runs this file first on PATH.
//
// It knows only what run-in-docker.sh and the helpers it sources from
// run-piston.sh call:
//   docker info
//   docker [container] inspect [--format F] NAME
//   docker exec [-u 0] [-i] NAME sh -c 'umask 077 && cat > "$1"' sh PATH   (plant a file)
//                              stat -c '%a %U' PATH     rm -f -- PATH
//   docker logs --since 5m NAME
// Anything else, and any `--format` string it does not recognise, exits with
// status 99 and says so, so a script change that starts using something new
// makes the self-test fail instead of passing on a guess. In particular there is
// no `run`, `rm`, `stop`, `kill`, `restart` or `update` here: run-in-docker.sh
// must never need them.
//
// State is a JSON file named by FAKE_DOCKER_STATE (selftest.mjs writes it and
// changes it per test). Every call is appended to state.callsLog.
//   { callsLog, daemonDown, recentJobs, failPlant, files: {path: content},
//     container: { name, status, privileged, memory, memorySwap, pidsLimit,
//                  nanoCpus, restartPolicy, bindings: ["2000/tcp -> 127.0.0.1:2000"],
//                  logConfig: "json-file 10m x3", env: ["PISTON_X=1", ...],
//                  startedAt, restartedStartedAt, restartCount,
//                  restartAfterMarkReads, markReads } }
// restartAfterMarkReads: the container "restarts" (StartedAt changes) after that
// many reads of `{{.State.StartedAt}} restarts=...`; run-in-docker.sh reads it
// once before and once after the attacks.
// =============================================================================
import fs from 'node:fs';

const statePath = process.env.FAKE_DOCKER_STATE;
if (!statePath) {
  console.error('fake-docker: FAKE_DOCKER_STATE is not set');
  process.exit(99);
}
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const save = () => fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
const args = process.argv.slice(2);
const record = (extra = {}) => fs.appendFileSync(state.callsLog, `${JSON.stringify({ args, ...extra })}\n`);

function unsupported(what) {
  record({ unsupported: what });
  console.error(`fake-docker: unsupported ${what}: docker ${args.join(' ')}`);
  process.exit(99);
}

function fail(message, code = 1) {
  record({ failed: message });
  console.error(message);
  process.exit(code);
}

function needContainer(name) {
  const c = state.container;
  if (!c || name !== c.name) fail(`Error: No such container: ${name}`);
  return c;
}

/** Same text as `docker inspect --format` gives for the formats the scripts use. */
function render(format, c) {
  switch (format) {
    case '{{.State.Status}}':
      return c.status;
    case '{{.HostConfig.Privileged}}':
      return String(c.privileged);
    case '{{.HostConfig.Memory}}':
      return String(c.memory);
    case '{{.HostConfig.MemorySwap}}':
      return String(c.memorySwap);
    case '{{.HostConfig.PidsLimit}}':
      return c.pidsLimit === null || c.pidsLimit === undefined ? '<nil>' : String(c.pidsLimit);
    case '{{.HostConfig.NanoCpus}}':
      return String(c.nanoCpus);
    case '{{.HostConfig.RestartPolicy.Name}}':
      return c.restartPolicy;
    case '{{.State.StartedAt}}':
      return c.startedAt;
    case '{{.State.StartedAt}} restarts={{.RestartCount}}': {
      c.markReads = (c.markReads ?? 0) + 1;
      save();
      const restarted = c.restartAfterMarkReads !== null && c.restartAfterMarkReads !== undefined && c.markReads > c.restartAfterMarkReads;
      return `${restarted ? c.restartedStartedAt : c.startedAt} restarts=${c.restartCount}`;
    }
    default:
      break;
  }
  if (format.includes('.HostConfig.PortBindings')) return c.bindings.map((line) => `${line}\n`).join('');
  if (format.includes('.HostConfig.LogConfig')) return c.logConfig;
  if (format.includes('range .Config.Env')) return c.env.map((line) => `${line}\n`).join('');
  return unsupported(`inspect format ${format}`);
}

function inspect(argv) {
  let format = null;
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--format' || argv[i] === '-f') format = argv[++i];
    else if (argv[i].startsWith('--format=')) format = argv[i].slice('--format='.length);
    else rest.push(argv[i]);
  }
  if (rest.length !== 1) unsupported('inspect arguments');
  const c = needContainer(rest[0]);
  record();
  process.stdout.write(format === null ? '[{}]\n' : `${render(format, c)}\n`);
}

function exec(argv) {
  let i = 0;
  while (i < argv.length && argv[i].startsWith('-')) i += argv[i] === '-u' ? 2 : 1;
  const c = needContainer(argv[i]);
  const cmd = argv.slice(i + 1);
  if (c.status !== 'running') fail(`Error response from daemon: container ${c.name} is not running`);
  record();
  if (cmd[0] === 'sh' && cmd[1] === '-c' && cmd[2] === 'umask 077 && cat > "$1"' && cmd[3] === 'sh' && cmd.length === 5) {
    if (state.failPlant) fail(`sh: 1: cannot create ${cmd[4]}: Directory nonexistent`);
    let content = '';
    try {
      content = fs.readFileSync(0, 'utf8');
    } catch {
      content = '';
    }
    state.files[cmd[4]] = content;
    save();
    return;
  }
  if (cmd[0] === 'stat' && cmd[1] === '-c' && cmd[2] === '%a %U' && cmd.length === 4) {
    if (!(cmd[3] in state.files)) fail(`stat: cannot statx '${cmd[3]}': No such file or directory`);
    process.stdout.write('600 root\n');
    return;
  }
  if (cmd[0] === 'rm' && cmd[1] === '-f' && cmd[2] === '--' && cmd.length === 4) {
    delete state.files[cmd[3]];
    save();
    return;
  }
  unsupported(`exec command ${cmd.join(' ')}`);
}

function logs(argv) {
  if (argv.length !== 3 || argv[0] !== '--since') unsupported('logs arguments');
  needContainer(argv[2]);
  record();
  for (let n = 0; n < (state.recentJobs ?? 0); n++) process.stdout.write('[INFO] job/00000000 - Executing job runtime=python-3.10.0\n');
}

const [cmd, ...rest] = args;
if (state.daemonDown) fail('Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?');
switch (cmd) {
  case 'info':
    record();
    break;
  case 'inspect':
    inspect(rest);
    break;
  case 'container':
    if (rest[0] !== 'inspect') unsupported('container subcommand');
    inspect(rest.slice(1));
    break;
  case 'exec':
    exec(rest);
    break;
  case 'logs':
    logs(rest);
    break;
  default:
    unsupported('command');
}
