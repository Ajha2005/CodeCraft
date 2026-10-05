#!/usr/bin/env bash
# =============================================================================
# run-in-docker.sh: run the Piston escape tests on the EC2 box, against the
# Piston container that is already running there (default name: piston-api).
#
#   deploy/escape-tests/run-in-docker.sh               asks before it starts
#   deploy/escape-tests/run-in-docker.sh --yes         no question (needed without a terminal)
#   deploy/escape-tests/run-in-docker.sh --container NAME
#
# READ THIS FIRST
#   The suite (run.mjs) sends HOSTILE programs to Piston, in Python and in C++:
#   an infinite loop, a fork bomb, 100 MB of stdout and of stderr, a 2 GB memory
#   bomb, reads of /etc/shadow, of other processes' environment and of the
#   host's disks, writes outside the sandbox, and outbound network (internet,
#   DNS, the Docker host, the EC2 metadata service at 169.254.169.254).
#   They run INSIDE Piston's sandbox, in the production container, and nowhere
#   else. That is safe for the box because the container has hard limits
#   (memory, swap, pids, cpus: deploy/piston/run-piston.sh), and this script
#   refuses to start without them. Piston is busy while the tests run and may
#   answer slowly for a few seconds, so RUN IT WHEN NOBODY IS USING THE SITE.
#
# WHAT IT CHANGES
#   Nothing about the container's configuration. It only reads: docker inspect,
#   docker logs, GET /api/v2/runtimes. The one write is two small root-only
#   "canary" files that it creates inside the container (see CANARY_FILES) so
#   the file-access test can prove a job cannot read them; they are deleted
#   again when the script ends, however it ends.
#
# BEFORE IT ATTACKS, it checks that
#   - node (20+), docker and curl exist, and the Docker daemon answers;
#   - PISTON_URL is a loopback address (the default is http://127.0.0.1:2000),
#     and is the port this container publishes. A remote URL is always refused;
#   - the container exists and is running;
#   - Piston answers and has python 3.10.0 and gcc 10.2.0 (c++) installed;
#   - the container's memory and pids limits exist (no limit = refuse), and it
#     prints every limit next to what run-piston.sh would have set. A
#     difference is reported and makes the final result FAIL.
# AFTER THE RUN it checks that the container is still running and was not
# restarted, and that Piston still answers.
#
# EXIT STATUS: 0 every check passed, 1 at least one check or fact failed,
#              2 the tests could not run (nothing hostile was sent).
# NEEDS: Node 20+, docker (user in the "docker" group, no sudo), curl, bash.
# =============================================================================
set -euo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PISTON_SH="${HERE}/../piston/run-piston.sh"
RUN_MJS="${HERE}/run.mjs"

if [[ ! -r "$PISTON_SH" ]]; then
  printf '[escape-tests] NOT RUN: cannot read %s\n' "$PISTON_SH" >&2
  exit 2
fi
# run-piston.sh holds the container settings (name, memory, swap, pids, cpus,
# port, package versions), the path of limits.env and the read-only helpers used
# below. Sourcing it starts nothing: it runs main only when executed directly.
# shellcheck source-path=SCRIPTDIR source=../piston/run-piston.sh
source "$PISTON_SH"
LOG_TAG="escape-tests"

# ----- Settings --------------------------------------------------------------
CONTAINER="${PISTON_CONTAINER:-$CONTAINER_NAME}"
PISTON_URL="${PISTON_URL:-http://${BIND_ADDR}:${HOST_PORT}}"

# Root-only files planted in the container for the file-access test. Their
# content is a random token; run.mjs must never see it in any response.
CANARY_FILES=(/root/cc-canary.txt /var/tmp/cc-canary.txt)

ASSUME_YES=0
FACTS_OK=1
CANARY_TOKEN=""
CANARY_TRIED=0
PLANTED=()
OUT_FILE=""
MARK_BEFORE=""

refuse() { printf '[%s] NOT RUN: %s\n' "$LOG_TAG" "$*" >&2; exit 2; }

usage() {
  printf '%s\n' \
    'usage: run-in-docker.sh [--yes] [--container NAME]' \
    '' \
    'Runs deploy/escape-tests/run.mjs against the Piston container on this machine.' \
    '  -y, --yes             do not ask first (needed when there is no terminal)' \
    '  -c, --container NAME  container to inspect (default: piston-api, or PISTON_CONTAINER)' \
    '' \
    'Environment: PISTON_URL (loopback only; default http://127.0.0.1:2000) and what run.mjs' \
    'reads: ONLY=network,file-access  LANGS=python  VERBOSE=1  WALL_SLACK_MS  API_RECOVERY_MS' \
    '' \
    'Exit status: 0 every check passed, 1 something failed, 2 the tests could not run.'
}

parse_args() {
  while (( $# > 0 )); do
    case "$1" in
      -y|--yes) ASSUME_YES=1 ;;
      -c|--container)
        (( $# >= 2 )) || refuse "$1 needs a container name"
        CONTAINER="$2"
        shift ;;
      --container=*) CONTAINER="${1#--container=}" ;;
      -h|--help) usage; exit 0 ;;
      *) usage >&2; refuse "unknown argument: $1" ;;
    esac
    shift
  done
  [[ "$CONTAINER" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || refuse "'${CONTAINER}' is not a valid container name"
}

print_banner() {
  printf '%s\n' \
    '' \
    '=== Piston escape tests ===' \
    '' \
    "These tests run HOSTILE programs inside the Piston container \"${CONTAINER}\" on this machine:" \
    '  - an infinite loop, a fork bomb, 100 MB of stdout and of stderr, a 2 GB memory bomb' \
    "  - reads of /etc/shadow, of other processes' environment and of the host's disks" \
    '  - writes outside the sandbox, and outbound network (internet, DNS, the Docker host,' \
    '    the EC2 metadata service at 169.254.169.254)' \
    'Python and C++, one program at a time, about 20 checks, usually under 2 minutes.' \
    '' \
    "They run only inside Piston's sandbox. They are safe for this box because the container" \
    'has hard memory, swap, pids and cpu limits (deploy/piston/run-piston.sh); this script' \
    'refuses to go on without them. Piston is busy while they run and may answer slowly for' \
    'a few seconds, so RUN THIS WHEN NOBODY IS USING THE SITE.' \
    '' \
    'Nothing about the container is changed. Two small canary files are created inside it and' \
    'deleted again at the end.' \
    ''
}

# ----- Preflight (reads only, nothing hostile is sent yet) ---------------------

check_tools() {
  local cmd major
  for cmd in docker curl node; do
    command -v "$cmd" >/dev/null 2>&1 || refuse "'${cmd}' not found. This script needs Node 20+, docker and curl."
  done
  major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  (( major >= 20 )) || refuse "Node ${major} is too old: run.mjs needs Node 20 or newer (check: node --version)"
  docker info >/dev/null 2>&1 \
    || refuse "cannot talk to the Docker daemon (is it running, and is this user in the 'docker' group?)"
}

# Only a loopback http URL is accepted, with an optional port and nothing else
# (no user name, no path), so that "127.0.0.1@evil.example" or
# "127.0.0.1.evil.example" cannot slip through. run.mjs repeats the check, and
# ALLOW_REMOTE is removed from its environment below.
check_url() {
  local re='^http://(127(\.[0-9]{1,3}){3}|localhost|\[::1\])(:[0-9]{1,5})?/?$'
  [[ "$PISTON_URL" =~ $re ]] \
    || refuse "PISTON_URL=${PISTON_URL} is not a loopback address (127.x.x.x, localhost or [::1]). These tests start a fork bomb and a memory bomb and must only ever hit the Piston on this machine."
  PISTON_URL="${PISTON_URL%/}"
}

check_container() {
  local status line published url_port
  status="$(docker container inspect --format '{{.State.Status}}' "$CONTAINER" 2>/dev/null)" \
    || refuse "there is no container named '${CONTAINER}'. Create it with deploy/piston/run-piston.sh (or pass --container NAME)."
  [[ "$status" == "running" ]] \
    || refuse "container '${CONTAINER}' is ${status}, not running. Start it with: docker start ${CONTAINER}   (logs: docker logs --tail 50 ${CONTAINER})"
  log "container ${CONTAINER} is running"

  # The URL must lead to the container whose limits are shown below.
  line="$(inspect_field "$CONTAINER" "$PORT_BINDINGS_TEMPLATE" | grep '^2000/tcp -> ' | head -n 1 || true)"
  [[ -n "$line" ]] || refuse "container '${CONTAINER}' does not publish Piston's port 2000 on the host, so this machine cannot reach it"
  published="${line#*-> }"
  url_port=80
  if [[ "$PISTON_URL" =~ :([0-9]+)$ ]]; then
    url_port="${BASH_REMATCH[1]}"
  fi
  [[ "${published##*:}" == "$url_port" ]] \
    || refuse "PISTON_URL (${PISTON_URL}) is not the port that container '${CONTAINER}' publishes (${published}), so the limits shown below would belong to a different Piston. Fix PISTON_URL or --container."
}

check_runtimes() {
  local missing=0
  curl -fsS --max-time 5 -o /dev/null "${PISTON_URL}/api/v2/runtimes" \
    || refuse "Piston does not answer at ${PISTON_URL}/api/v2/runtimes. See: docker logs --tail 50 ${CONTAINER}"
  if runtime_installed "$PISTON_URL" python "$PYTHON_VERSION"; then
    log "python ${PYTHON_VERSION} is installed"
  else
    missing=1
    log "python ${PYTHON_VERSION} is NOT installed"
  fi
  if runtime_installed "$PISTON_URL" 'c++' "$GCC_VERSION"; then
    log "gcc ${GCC_VERSION} (c++) is installed"
  else
    missing=1
    log "gcc ${GCC_VERSION} (c++) is NOT installed"
  fi
  if (( missing != 0 )); then
    printf '%s\n' '' 'Install the missing package(s) with these commands (each one downloads for a few minutes), then run this script again:' >&2
    printf "  curl -fsS -X POST %s/api/v2/packages -H 'Content-Type: application/json' -d '{\"language\":\"python\",\"version\":\"%s\"}'\n" "$PISTON_URL" "$PYTHON_VERSION" >&2
    printf "  curl -fsS -X POST %s/api/v2/packages -H 'Content-Type: application/json' -d '{\"language\":\"gcc\",\"version\":\"%s\"}'\n" "$PISTON_URL" "$GCC_VERSION" >&2
    printf '%s\n' '(deploy/piston/run-piston.sh installs both as well, but it re-creates the container.)' >&2
    refuse "a package the tests need is missing"
  fi
}

# Prints every limit of the container beside the value run-piston.sh sets, and
# remembers a difference (it changes nothing). The memory and pids limits are
# what makes the hostile programs safe for this box, so without them: refuse.
report_limits() {
  local mem pids
  if ! check_container_facts "$CONTAINER" "$HOST_PORT" "$RESTART_POLICY"; then
    FACTS_OK=0
    log "the container differs from deploy/piston/run-piston.sh (MISMATCH lines above); the tests still run against it as it is, but the final result will be FAIL. Re-run deploy/piston/run-piston.sh to apply the intended settings."
  fi
  mem="$(inspect_field "$CONTAINER" '{{.HostConfig.Memory}}')"
  pids="$(inspect_field "$CONTAINER" '{{.HostConfig.PidsLimit}}')"
  if ! [[ "$mem" =~ ^[0-9]+$ ]] || (( mem == 0 )); then
    refuse "container '${CONTAINER}' has no memory limit; a memory bomb could take the whole box down. Re-create it with deploy/piston/run-piston.sh."
  fi
  if ! [[ "$pids" =~ ^[0-9]+$ ]] || (( pids == 0 )); then
    refuse "container '${CONTAINER}' has no pids limit; a fork bomb could exhaust the whole box. Re-create it with deploy/piston/run-piston.sh."
  fi
}

# Piston logs one "Executing job" line per job at the default log level.
warn_if_busy() {
  local jobs
  jobs="$(docker logs --since 5m "$CONTAINER" 2>&1 | grep -c 'Executing job' || true)"
  if [[ "$jobs" =~ ^[0-9]+$ ]] && (( jobs > 0 )); then
    log "WARNING: Piston ran ${jobs} job(s) in the last 5 minutes (from its log). If those were real users, wait until the site is quiet."
  fi
}

confirm() {
  local answer=""
  if (( ASSUME_YES == 1 )); then
    return 0
  fi
  if [[ ! -t 0 || ! -t 1 ]]; then
    refuse "there is no terminal to ask on. Run again with --yes to confirm that nobody is using the site."
  fi
  read -r -p "Nobody is using the site and you want to run the attacks now? Type yes: " answer || true
  [[ "$answer" == "yes" ]] || refuse "cancelled; nothing hostile was sent to Piston"
}

# ----- Canary files -------------------------------------------------------------

plant_canaries() {
  local path
  CANARY_TOKEN="CC-CANARY-$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
  CANARY_TRIED=1
  for path in "${CANARY_FILES[@]}"; do
    # shellcheck disable=SC2016  # $1 is expanded by the shell inside the container
    if printf '%s\n' "$CANARY_TOKEN" | docker exec -u 0 -i "$CONTAINER" sh -c 'umask 077 && cat > "$1"' sh "$path" \
       && [[ "$(docker exec -u 0 "$CONTAINER" stat -c '%a %U' "$path" 2>/dev/null)" == "600 root" ]]; then
      PLANTED+=("$path")
    else
      log "warning: could not plant a canary file at ${path}; that read is skipped"
    fi
  done
  log "${#PLANTED[@]} canary file(s) planted (root only, mode 600)"
}

# shellcheck disable=SC2329  # runs from the EXIT trap in main_run
cleanup() {
  local path
  if (( CANARY_TRIED == 1 )); then
    for path in "${CANARY_FILES[@]}"; do
      docker exec -u 0 "$CONTAINER" rm -f -- "$path" >/dev/null 2>&1 || true
    done
  fi
  if [[ -n "$OUT_FILE" ]]; then
    rm -f -- "$OUT_FILE"
  fi
}

# ----- The run --------------------------------------------------------------------

container_mark() { inspect_field "$CONTAINER" '{{.State.StartedAt}} restarts={{.RestartCount}}'; }

run_suite() {
  local canary_path rc=0
  canary_path=""
  if (( ${#PLANTED[@]} > 0 )); then
    canary_path="$(IFS=:; printf '%s' "${PLANTED[*]}")"
  fi
  MARK_BEFORE="$(container_mark)"
  OUT_FILE="$(mktemp)"
  log "running ${RUN_MJS##*/} against ${PISTON_URL} (about a minute; the table appears at the end, VERBOSE=1 shows progress)"
  printf '\n'
  # ALLOW_REMOTE is removed so that nothing in the caller's environment can
  # point the attacks at another machine. The limits judged against are the
  # repository's limits.env, the same file the container was started with.
  env -u ALLOW_REMOTE \
    PISTON_URL="$PISTON_URL" \
    LIMITS_ENV_FILE="$LIMITS_ENV" \
    CANARY_PATH="$canary_path" \
    CANARY_TOKEN="$CANARY_TOKEN" \
    node "$RUN_MJS" 2>&1 | tee "$OUT_FILE" || rc=$?
  return "$rc"
}

# True when Piston answers again within about 20 seconds (it may be restarting).
api_answers() {
  local _
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsS --max-time 3 -o /dev/null "${PISTON_URL}/api/v2/runtimes" 2>/dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
}

main_run() {
  local suite_rc=0 held=1 status mark_after counts failing exit_code=0

  parse_args "$@"
  check_url
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  print_banner
  check_tools
  check_container
  check_runtimes
  report_limits
  warn_if_busy
  confirm
  plant_canaries

  run_suite || suite_rc=$?

  if (( suite_rc == 2 )); then
    printf '\n[%s] NOT RUN: run.mjs could not run the tests (exit status 2, see its message above).\n' "$LOG_TAG" >&2
    exit 2
  fi

  # Did the attacks take the container down, even for a moment?
  printf '\n'
  status="$(inspect_field "$CONTAINER" '{{.State.Status}}' 2>/dev/null || echo gone)"
  mark_after="$(container_mark 2>/dev/null || echo gone)"
  if [[ "$status" != "running" ]]; then
    held=0
    log "container ${CONTAINER} is now: ${status}"
  elif [[ "$mark_after" != "$MARK_BEFORE" ]]; then
    held=0
    log "container ${CONTAINER} was restarted during the tests (was: ${MARK_BEFORE}; now: ${mark_after})"
  elif ! api_answers; then
    held=0
    log "Piston no longer answers at ${PISTON_URL}"
  fi

  counts="$(grep -E '^[0-9]+ checks: ' "$OUT_FILE" | tail -n 1 || true)"
  failing="$(sed -nE 's/^([a-z-]+) +(python|c\+\+|any) +FAIL( .*)?$/\1 (\2)/p' "$OUT_FILE" | paste -sd, - | sed 's/,/, /g' || true)"

  printf '%s\n' '------------------------------------------------------------------------'
  printf '  %-49s %s\n' "container limits match run-piston.sh:" "$( (( FACTS_OK == 1 )) && echo yes || echo 'NO (see MISMATCH lines)')"
  printf '  %-49s %s\n' "suite (run.mjs):" "${counts:-no result line} (exit status ${suite_rc})"
  printf '  %-49s %s\n' "container still running, not restarted, API up:" "$( (( held == 1 )) && echo yes || echo NO)"
  if (( suite_rc != 0 || FACTS_OK != 1 || held != 1 )); then
    exit_code=1
    [[ -z "$failing" ]] || printf '  %-49s %s\n' "failed checks:" "$failing"
    printf '%s\n' 'RESULT: FAIL' 'What each failure means and what to tighten: deploy/escape-tests/README.md, "When a check fails".'
  else
    printf '%s\n' 'RESULT: PASS: every attack was contained and the container held.'
  fi
  exit "$exit_code"
}

main_run "$@"
