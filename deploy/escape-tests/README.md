# Piston escape tests

CodeCraft runs strangers' code in Piston, in a Docker container that has to be
started with `--privileged`. These tests send Piston the classic hostile programs
and check that each one is stopped by a limit or cannot reach its target. If one
gets through, the test says FAIL and names it.

Run them on the EC2 box after the first deploy and again after every change to
`deploy/piston/limits.env`, to the flags in `deploy/piston/run-piston.sh`, or to
the Piston image.

## Run it on the EC2 box

You need Node 20 or newer, `docker` (as a user in the `docker` group, no `sudo`)
and `curl`, and Piston already running with Python and gcc installed
(`deploy/piston/run-piston.sh` does all of that).

**Run it when nobody is using the site.** The programs are hostile on purpose:
an infinite loop, a fork bomb, 100 MB of output, a 2 GB memory bomb, file reads,
and outbound network. They run inside Piston's sandbox only, and the container's
memory, swap, pids and cpu limits keep them from hurting the rest of the box,
but Piston is busy and may answer slowly for a few seconds while they run.

```bash
cd ~/CodeCraft                          # wherever the repo is checked out on the server
node --version                          # v20 or newer
deploy/escape-tests/run-in-docker.sh    # prints a warning and asks you to type yes
```

Options and variables:

```bash
deploy/escape-tests/run-in-docker.sh --yes                 # no question (needed without a terminal, e.g. over plain ssh)
deploy/escape-tests/run-in-docker.sh --container NAME      # default piston-api
ONLY=network,file-access LANGS=python deploy/escape-tests/run-in-docker.sh   # a subset
VERBOSE=1 deploy/escape-tests/run-in-docker.sh --yes       # progress, and details that are not cut short
```

`ONLY` takes scenario names from the table below, `LANGS` takes `python` and/or
`cpp`. `PISTON_URL` may be set, but only to a loopback address
(`http://127.0.0.1:2000` is the default); anything else is refused, and
`ALLOW_REMOTE` is removed from the environment so it cannot be used to get around that.

### What the script does

1. Checks Node 20+, docker, curl and the Docker daemon.
2. Checks that the container exists and is running, that `PISTON_URL` is a loopback
   address and is the port this container publishes, and that Piston answers.
3. Checks that python 3.10.0 and gcc 10.2.0 are installed. If not, it prints the
   two `curl -X POST .../api/v2/packages` commands that install them and stops.
4. Reports, without changing anything, the container's settings from
   `docker inspect` (privileged, memory, swap, pids, cpus, restart policy, the
   published port, log rotation, and every line of `limits.env`) next to the
   values `run-piston.sh` sets. A difference is printed as `MISMATCH` and makes
   the final result FAIL. It refuses to run at all if the container has no
   memory limit or no pids limit.
5. Warns if Piston's log shows jobs in the last 5 minutes (someone may be using the site).
6. Asks you to confirm (unless `--yes`), then creates two root-only canary files
   in the container (`/root/cc-canary.txt`, `/var/tmp/cc-canary.txt`, random
   content) and runs `run.mjs`. The canaries are deleted when the script ends,
   even on Ctrl-C.
7. Afterwards checks that the container is still running, was not restarted
   (same `StartedAt` and restart count) and that Piston answers.

Exit status: `0` every check passed, `1` something failed, `2` the tests could not
run (nothing hostile was sent).

## What is tested

Every scenario runs in Python and in C++ (except `limit-raise`, which is a plain
HTTP request). Time and size thresholds are derived from `deploy/piston/limits.env`.

| Scenario | What the program does | PASS looks like | What stops it |
|---|---|---|---|
| `sanity` | Prints a marker. | It ran cleanly and printed the marker. If this fails the other results mean nothing: Piston or a package is broken. | Not an attack. |
| `infinite-loop` | `while True: pass`; in C++ a counting loop. | Status `TO` (or `SG`) within the run timeout + 5 s, and the API answers afterwards. | `PISTON_RUN_TIMEOUT` (wall clock) and `PISTON_RUN_CPU_TIME`, both 3000 ms. |
| `fork-bomb` | Forks without end (`os.fork()` / `fork()` in a loop). | The job ends with `RE`, `SG` or `TO`, never a clean exit, within the time budget, and `GET /api/v2/runtimes` answers within 10 s afterwards. | `PISTON_MAX_PROCESS_COUNT` (64 processes per job). Backstop: `--pids-limit` (`CONTAINER_PIDS_LIMIT`, 256). |
| `huge-output` | Writes about 100 MB to stdout, then prints a "survived" marker. | Status `OL`, no marker, the HTTP response smaller than 4 x `PISTON_OUTPUT_MAX_SIZE` + 32 KiB (288 KiB), API alive. | `PISTON_OUTPUT_MAX_SIZE` (65536). |
| `huge-stderr` | The same on stderr. | Status `EL`, otherwise as above. | `PISTON_OUTPUT_MAX_SIZE`. |
| `file-access` | About 30 probes in one program: opens `/etc/shadow`, `/etc/gshadow`, root's shell history, ssh key, AWS and Docker credentials, `/dev/mem` and the host's disk devices; lists `/root` and `/home`; looks for `/var/run/docker.sock`; tries to enter PID 1's root directory through `/proc/1/root`; creates a file in `/etc`, `/usr`, `/piston_api`, `/piston/packages` (and the python and gcc folders in it) and `/`; reads every `/proc/*/environ` looking for `PISTON_` and `CANARY_` variables; reads the two canary files. | Every probe is BLOCKED (permission denied or not visible), and no secret-shaped text appears in the output. Two control probes must succeed (reading `/etc/passwd`, creating a file in the job's own directory), so a broken probe cannot produce a green result. | Piston's sandbox (isolate: its own mount and PID namespaces and one unprivileged user id per job) and plain file permissions. Nothing in `limits.env` controls this. |
| `env-leak` | Prints its own environment. | No `PISTON_*` variable except `PISTON_LANGUAGE`, no `CANARY_*`, no variable named like a secret (`TOKEN`, `SECRET`, `AWS_`, `DATABASE_URL`, ...), no secret-shaped value. | The sandbox starts jobs with a cleaned environment. The Piston server's own environment is all of `limits.env`, so it must never reach a job. |
| `network` | TCP connects to `1.1.1.1:443` (internet), `172.17.0.1:3000` and `:22` (the Docker host: backend and sshd), `127.0.0.1:2000` (Piston itself), `169.254.169.254` (EC2 metadata; HTTP in Python, raw TCP in C++), and a DNS lookup of `example.com`. | Every connect is impossible: `socket()` is denied, or `connect()` fails at once with errno 101 "Network is unreachable" (the job sits in an empty network namespace). DNS and HTTP fail. A refused (111), timed-out or "no route to host" connect is a FAIL, because it proves a route exists. | `PISTON_DISABLE_NETWORKING=true`. |
| `memory-bomb` | Allocates and touches 2 GiB in 16 MiB blocks. | The job is killed (`RE` or `SG`) before it prints its marker. A timeout is not a pass: it means the memory limit did not act. API alive. | `PISTON_RUN_MEMORY_LIMIT` (134217728 = 128 MiB). Backstop: `--memory` (`CONTAINER_MEMORY`, 640m). |
| `limit-raise` | One request each that asks for 10 times the cap in `run_timeout`, `run_cpu_time`, `run_memory_limit`, `compile_timeout`, `compile_cpu_time`, `compile_memory_limit`. | All six answered with HTTP 400 "... cannot exceed the configured limit of N". | The six caps themselves: `PISTON_RUN_TIMEOUT`, `PISTON_RUN_CPU_TIME`, `PISTON_RUN_MEMORY_LIMIT` and the three `PISTON_COMPILE_*` ones. Piston ignores a cap that is 0 or less. |

The harness treats "stopped by a limit, or could not reach the target" as PASS
and "reached the target, or ran without bound" as FAIL. A check that produced no
result counts as FAIL, never as PASS. After every heavy attack it asks
`GET /api/v2/runtimes` for up to 10 s, to prove Piston is still answering.

Timing: a response must arrive within run timeout + 5 s (plus the compile
timeout for C++). `WALL_SLACK_MS` and `API_RECOVERY_MS` change those two
numbers if a slow box needs more room.

## Reading the output

`run-in-docker.sh` first prints the warning, then the preflight checks and the
`docker inspect` table, then the table from `run.mjs`, then a summary. A passing
run looks like this (example from the offline mock, with long parts left out;
times on a real Piston differ):

```
[escape-tests] container piston-api is running
[escape-tests] python 3.10.0 is installed
[escape-tests] gcc 10.2.0 (c++) is installed
[escape-tests] docker inspect facts for piston-api:
  State.Status                       running                        ok
  HostConfig.Privileged              true                           ok
  HostConfig.Memory (bytes)          671088640                      ok
  HostConfig.MemorySwap              1073741824                     ok
  HostConfig.PidsLimit               256                            ok
  HostConfig.NanoCpus                1500000000                     ok
  ...
  limits.env applied                 all lines present              ok

SCENARIO       LANG    RESULT  DETAIL
-------------  ------  ------  --------------------
sanity         python  PASS    hello world ran in 6 ms
sanity         c++     PASS    hello world ran in 2 ms (compile + run)
infinite-loop  python  PASS    stopped with TO after 3005 ms (run timeout 3000 ms); API alive afterwards
...
file-access    python  PASS    31 probes: every read/list/stat/write blocked, controls OK, no canary content seen
network        python  PASS    6 targets: every TCP connect impossible (ENETUNREACH, no route), DNS and HTTP failed
memory-bomb    python  PASS    stopped with RE after 1 ms; API alive afterwards
...
19 checks: 19 PASS, 0 FAIL
RESULT: PASS: every attack was contained.

------------------------------------------------------------------------
  container limits match run-piston.sh:             yes
  suite (run.mjs):                                  19 checks: 19 PASS, 0 FAIL (exit status 0)
  container still running, not restarted, API up:   yes
RESULT: PASS: every attack was contained and the container held.
```

- `SCENARIO`, `LANG`, `RESULT`, `DETAIL`: one row per check. The detail says why
  (for a FAIL, the first problems found, worst first). It is cut at about 118
  characters; `VERBOSE=1` shows all of it.
- Status letters are Piston's: `TO` timeout, `SG` killed by a signal, `RE` runtime
  error (non-zero exit), `OL` / `EL` stdout / stderr limit, `XX` Piston's own error.
- A FAIL never prints the secret it found, only what kind of thing it was.
- In the `docker inspect` table `ok` means the container has the value
  `run-piston.sh` sets; `MISMATCH` means it does not (usually: the container is
  older than the current script, so run `deploy/piston/run-piston.sh` again).
  After the memory test Docker may show `OOMKilled=true` for the container; what
  matters is that it is still running with the same `StartedAt`, which the
  summary checks.

## When a check fails

Change the setting named below, run `deploy/piston/run-piston.sh` (it re-creates
the container with the new values; installed packages stay), then run the tests again.
`limits.env` values are per job; the `CONTAINER_*` names are the settings at the
top of `run-piston.sh` (they become `--memory`, `--memory-swap`, `--pids-limit`, `--cpus`).

| Failing check | What it means | What to do |
|---|---|---|
| `sanity` | Piston cannot run a hello world. Not a security finding. | `docker logs --tail 50 piston-api`. Is the package installed (`curl -s 127.0.0.1:2000/api/v2/runtimes`)? Piston needs a host with cgroup v2 only (Ubuntu 24.04 has it). |
| `infinite-loop` | A loop outlived its limits, or Piston hung ("no response within ..."). | Make sure `PISTON_RUN_TIMEOUT` and `PISTON_RUN_CPU_TIME` are in `limits.env` (3000). For C++ also `PISTON_COMPILE_TIMEOUT`. If Piston hung, lower `CONTAINER_CPUS`. |
| `fork-bomb` | A clean exit (nothing stopped it), or the API died afterwards. | Lower `PISTON_MAX_PROCESS_COUNT`. Make sure `CONTAINER_PIDS_LIMIT` (`--pids-limit`) is set; if the API died, also check `CONTAINER_MEMORY` and `CONTAINER_CPUS`. |
| `huge-output`, `huge-stderr` | The 100 MB flood was not cut off, or the response was too big. | Set or lower `PISTON_OUTPUT_MAX_SIZE` (default in Piston is 1024; here 65536). |
| `memory-bomb` | The 2 GB allocation finished, or only a timeout ended it. | Set `PISTON_RUN_MEMORY_LIMIT` (Piston's own default, -1, is unlimited). Check `CONTAINER_MEMORY` and `CONTAINER_MEMORY_SWAP`. |
| `limit-raise` | A request was allowed to raise a limit. | One of the six caps is missing, 0 or negative. Set `PISTON_RUN_TIMEOUT`, `PISTON_COMPILE_TIMEOUT`, `PISTON_RUN_CPU_TIME`, `PISTON_COMPILE_CPU_TIME`, `PISTON_RUN_MEMORY_LIMIT` and `PISTON_COMPILE_MEMORY_LIMIT` to positive numbers. |
| `network` | A connection, a DNS lookup or the metadata service worked, or a route exists. | `PISTON_DISABLE_NETWORKING=true` must be in `limits.env` and in the running container (the table says "limits.env applied"). If it is, the sandbox is not isolating the network: stop Piston (`docker stop piston-api`) until you have updated the image. Then also do the metadata hardening below. |
| `env-leak` | A job can see a `PISTON_*` variable or something that looks like a secret. | Serious. Never put a secret in `limits.env`: it is the container's environment. If only `PISTON_*` names show, update the Piston image; stop Piston until the check passes. |
| `file-access` | A job could read, list, see or write something outside its sandbox. | Serious. Stop Piston (`docker stop piston-api`; runs and submissions then answer 503 "code runner unavailable", which is better than leaving this open). Check that `run-piston.sh` has no extra `-v` mount, `--pid=host` or `--network=host`, update the image, and run the tests again. |
| container not running / restarted | An attack took the whole container down. | `docker logs --tail 100 piston-api`, `sudo dmesg \| grep -i -E 'killed process\|out of memory'`. Lower `PISTON_RUN_MEMORY_LIMIT`, `PISTON_COMPILE_MEMORY_LIMIT`, `PISTON_MAX_PROCESS_COUNT`, or `CONTAINER_MEMORY`. |
| `MISMATCH` lines | The running container is not what `run-piston.sh` would create. | Run `deploy/piston/run-piston.sh`. |

## The offline self-test

```bash
node deploy/escape-tests/selftest.mjs
```

It needs no Docker, no Piston and no network, takes about a minute, and exits 0
only if everything below holds. It is how you know that a PASS from the real
suite is not just a harness that cannot fail:

- `mock-piston.mjs` is a tiny HTTP server that answers like Piston without
  running any code. In `MODE=safe` it behaves like a correctly configured Piston:
  loops end in `TO`, huge output in `OL`, file reads are denied, the network is
  unreachable, oversized limits are refused with 400. The harness must say PASS
  on every check.
- In `MODE=unsafe` it has every flaw in its `FLAWS` list at once (a loop that
  runs 60 seconds, an environment that contains `PISTON_RUN_MEMORY_LIMIT`, a
  successful connect to the Docker host, the metadata service answering, the
  canary file's content leaked, limits that a request can raise, an API that dies
  after the fork bomb, ...). The harness must say FAIL on each attack scenario.
- Then each flaw is switched on alone: it must fail exactly its own scenario, in
  the right language, with a message that says why, and nothing else.
- The attack programs are checked as code (`python3 -m py_compile`, `g++ -Wall
  -Wextra`) and the harmless ones are really run as an unprivileged user, so each
  probe the checks expect is also reported.
- `limits.env` and the thresholds the harness uses are checked against each other.
- `run-in-docker.sh` is driven with a fake `docker` (`fake-docker.mjs`) and the
  mock: it must exit 0 for a safe Piston, 1 for an unsafe one, 2 when it cannot
  run, refuse any non-loopback `PISTON_URL`, plant and remove its canary files,
  and never run a `docker` command that changes the container.

Run it again whenever you change anything in this folder.

## What this does not prove

A PASS means these particular attacks were stopped on this box today. It does not mean:

- **No escape by a bug nobody knows about.** The tests cannot find a flaw in the
  Linux kernel, in Docker/runc, or in Piston's sandbox (isolate); they only check that
  the common attacks fail.
- **`--privileged` is a large exposure.** A privileged container has every Linux
  capability, no seccomp or AppArmor profile from Docker, and can see the host's
  devices. Piston needs this because its sandbox creates namespaces and cgroups
  itself. So the wall between a hostile program and the host is Piston's sandbox,
  not Docker's container isolation. A job that broke out of the sandbox would be
  root in a privileged container, which is close to root on the host: it could
  mount the host's disk, and from there read `/etc/codecraft/backend.env`.
- **No seccomp profile restricts the syscalls of a job.** Network, file and
  process limits are what stop attacks, not a syscall filter.
- **Neighbours on the host.** The NestJS backend, Nginx, the pm2 daemon and the
  secrets file share the machine with Piston. The network test shows a job
  cannot connect to them, not that nothing could after an escape.
- **Not everything a job can exhaust.** Disk is limited per file
  (`PISTON_MAX_FILE_SIZE`), not in total; CPU credits on a burstable instance are
  not tested; the tests run one program at a time, not two at once.
- **Not tomorrow.** A new Piston image, a changed `limits.env` or a kernel update
  can change the answers. Run the tests again after each.

## Recommended: harden the EC2 metadata service

The metadata service at `169.254.169.254` hands out the instance's AWS
credentials, if the instance has a role. The `network` test proves a job cannot
reach it today. These steps keep it out of reach if a job ever gets network. They
are recommended, not required, and you should test each one as shown.

**1. Require IMDSv2 and a hop limit of 1.** Run this from your own computer or
AWS CloudShell (it needs the `ec2:ModifyInstanceMetadataOptions` permission); it
changes only the metadata service and takes effect at once, no reboot:

```bash
aws ec2 modify-instance-metadata-options --instance-id <id> \
  --http-tokens required --http-put-response-hop-limit 1
aws ec2 describe-instances --instance-ids <id> \
  --query 'Reservations[].Instances[].MetadataOptions'     # HttpTokens: required, HttpPutResponseHopLimit: 1
```

With `required`, a plain GET gets `401`; a caller must first fetch a token with a
PUT. With a hop limit of 1 that PUT answer cannot travel the extra hop into a
container, so containers cannot get a token. Software on the host keeps working
if it supports IMDSv2 (current AWS CLI, SDKs and the SSM agent do; very old ones
do not). Test it on the box:

```bash
# on the host: still works (prints the instance id)
TOKEN=$(curl -sS -m 3 -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')
curl -sS -m 3 -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id; echo
# without a token: 401
curl -s -o /dev/null -w '%{http_code}\n' -m 3 http://169.254.169.254/latest/meta-data/
# from inside the Piston container: must FAIL (times out after 3 s); before step 1 it printed 200
docker exec piston-api python3 -c "import urllib.request as u; r = u.Request('http://169.254.169.254/latest/api/token', method='PUT', headers={'X-aws-ec2-metadata-token-ttl-seconds': '60'}); print(u.urlopen(r, timeout=3).status)"
```

**2. Optional: drop container traffic to the metadata address at the firewall.**
Docker evaluates the `DOCKER-USER` chain before its own rules for traffic
leaving containers, so this blocks every container, whatever the hop limit says:

```bash
sudo iptables -I DOCKER-USER -d 169.254.169.254 -j DROP
sudo iptables -L DOCKER-USER -n -v --line-numbers      # the DROP rule is listed
# run the python3 command from step 1 again: it times out; the pkts counter of the rule goes up
```

The rule does not survive a reboot. To keep it, save this as
`/etc/systemd/system/block-imds-from-containers.service`, then
`sudo systemctl daemon-reload && sudo systemctl enable --now block-imds-from-containers`:

```ini
[Unit]
Description=Drop container traffic to the EC2 metadata service
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh -c 'iptables -C DOCKER-USER -d 169.254.169.254 -j DROP 2>/dev/null || iptables -I DOCKER-USER -d 169.254.169.254 -j DROP'

[Install]
WantedBy=multi-user.target
```

Host traffic does not go through `DOCKER-USER`, so the host itself still reaches
the metadata service. Afterwards run the escape tests again.

## Files in this folder

| File | What it is |
|---|---|
| `run-in-docker.sh` | The one to run on the EC2 box: checks, reports the container's limits, runs `run.mjs`, summarises. |
| `run.mjs` | The suite. Any Node 20+ machine; it only accepts a loopback Piston. |
| `programs.mjs` | The hostile programs (Python and C++), one per scenario. |
| `lib.mjs` | How responses are judged: thresholds, PASS/FAIL rules, leak detection. |
| `mock-piston.mjs` | A fake Piston with a safe mode and 25 switchable flaws, for the self-test. |
| `fake-docker.mjs` | A fake `docker` command for the self-test of `run-in-docker.sh`. |
| `selftest.mjs` | The offline test of all of the above. |
