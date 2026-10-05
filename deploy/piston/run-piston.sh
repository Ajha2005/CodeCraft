#!/usr/bin/env bash
# =============================================================================
# run-piston.sh: (re)create the production Piston code-execution container.
#
#   deploy/piston/run-piston.sh [--yes]
#
# Run it on the EC2 box as a user in the "docker" group. Safe to run again:
#   1. creates the named volume piston-packages if it is missing,
#   2. if a piston-api container already exists it SAYS SO and, on a terminal,
#      asks before it stops and re-creates it (packages live in the volume, so
#      nothing is re-downloaded; jobs in progress are lost). --yes skips the
#      question,
#   3. starts the container with the exact flags in start_piston_container,
#   4. waits (with a timeout) for GET /api/v2/runtimes,
#   5. installs python 3.10.0 and gcc 10.2.0 unless they are already there,
#   6. prints and VERIFIES `docker inspect` facts (memory, pids, cpus,
#      privileged, published port) and exits non-zero if any differ.
#
# This file is also SOURCED (never copied) by deploy/escape-tests/run-in-docker.sh.
# That script reads the settings below (container name, memory, swap, pids, cpus,
# port, package versions) and the read-only helpers, so it compares the running
# container with exactly what this file creates. Sourcing does not run main
# (see the guard at the bottom).
#
# This script needs only `docker` and `curl`.
# =============================================================================
set -euo pipefail

# ----- Tunables --------------------------------------------------------------
# Everything you may want to change is in this block. Plain assignments on
# purpose: an exported variable in someone's shell must not be able to alter
# what production runs.

# Image. For reproducible deploys pin a tag or a digest, for example
#   ghcr.io/engineer-man/piston@sha256:<digest>
# so that an upgrade is a deliberate edit, a `docker pull` and a re-run.
PISTON_IMAGE="ghcr.io/engineer-man/piston"

# Container name, and the named volume that holds the installed language
# packages (/piston/packages). The volume outlives the container, so packages
# are downloaded once, not on every re-create.
CONTAINER_NAME="piston-api"
VOLUME_NAME="piston-packages"
RESTART_POLICY="always"       # survives a reboot and a Docker restart

# The two packages the backend needs. Package "gcc" provides the runtime
# language "c++". Keep in step with LANGS in deploy/escape-tests/lib.mjs.
PYTHON_VERSION="3.10.0"
GCC_VERSION="10.2.0"

# Where the API is published on the host. KEEP BIND_ADDR AT 127.0.0.1.
# Docker publishes ports with its own iptables rules, which are evaluated
# before ufw's. A plain "-p 2000:2000" would therefore be reachable from the
# whole internet even if ufw denies port 2000. Piston runs strangers' code by
# design: only the backend on this same box (http://127.0.0.1:2000) may talk to it.
BIND_ADDR="127.0.0.1"
HOST_PORT="2000"

# Container limits for a 1 GB host (it also runs Nginx and the Node backend).
# Piston's own PISTON_*_LIMIT settings (limits.env) stop single jobs; these
# stop the container as a whole, so that when something has to give it is
# Piston, not the backend.
CONTAINER_MEMORY="640m"       # hard RAM cap for everything in the container
CONTAINER_MEMORY_SWAP="1g"    # RAM + swap cap, so at most 384 MB of swap
CONTAINER_PIDS_LIMIT="256"    # fork-bomb backstop: 2 jobs x 64 (PISTON_MAX_PROCESS_COUNT) + Piston itself
CONTAINER_CPUS="1.5"          # leaves half a vCPU for Nginx, Node and the OS
LOG_MAX_SIZE="10m"            # json-file log rotation: 3 x 10 MB at most, so
LOG_MAX_FILE="3"              # a chatty container cannot fill a small disk

# How long to wait for the API after starting, and for one package download.
STARTUP_TIMEOUT_S="120"
INSTALL_TIMEOUT_S="900"

# ----- Derived values (do not edit) ------------------------------------------
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
LIMITS_ENV="${SCRIPT_DIR}/limits.env"

log() { printf '[%s] %s\n' "${LOG_TAG:-run-piston}" "$*"; }
die() { printf '[%s] ERROR: %s\n' "${LOG_TAG:-run-piston}" "$*" >&2; exit 1; }

# ----- Helpers ---------------------------------------------------------------

# limits.env is handed to `docker run --env-file`, which is not a shell: quotes
# and trailing comments would silently become part of a value, and CR characters
# from a Windows editor would end up in every value. Refuse such a file up front.
validate_limits_env() {
  [[ -r "$LIMITS_ENV" ]] || die "cannot read ${LIMITS_ENV}"
  if grep -q $'\r' "$LIMITS_ENV"; then
    die "${LIMITS_ENV} has CR (Windows) line endings; every value would end with a CR character"
  fi
  local bad
  bad="$(grep -nEv $'^(#.*|[[:space:]]*|PISTON_[A-Z0-9_]+=[^[:space:]"\'#]*)$' "$LIMITS_ENV" || true)"
  if [[ -n "$bad" ]]; then
    printf '%s\n' "$bad" >&2
    die "${LIMITS_ENV}: the lines above are not plain PISTON_KEY=VALUE lines (no quotes, spaces or trailing comments)"
  fi
}

ensure_volume() { # <volume>
  if ! docker volume inspect "$1" >/dev/null 2>&1; then
    log "creating volume $1"
    docker volume create "$1" >/dev/null
  fi
}

# An existing container is replaced, so say what is about to happen first. On a
# terminal the script then asks; without one (a script, ssh without -t) it goes
# ahead after saying so, and --yes skips the question.
replace_container() { # <container> <1 = do not ask>
  local state started answer=""
  docker container inspect "$1" >/dev/null 2>&1 || return 0
  state="$(docker inspect --format '{{.State.Status}}' "$1")"
  started="$(docker inspect --format '{{.State.StartedAt}}' "$1")"
  log "container $1 already exists (${state}, started ${started})"
  log "it will be STOPPED and RE-CREATED from the settings in this file: Piston is down for"
  log "about a minute and any job in progress is lost. Installed packages stay (volume ${VOLUME_NAME})."
  if [[ "$2" != "1" && -t 0 && -t 1 ]]; then
    read -r -p "Type yes to go on: " answer || true
    [[ "$answer" == "yes" ]] || die "cancelled; $1 was not touched"
  fi
  log "removing existing container $1"
  docker rm -f "$1" >/dev/null
}

# THE production `docker run`; main passes the settings from the top of the file.
#   $1 container name   $2 host port   $3 volume   $4 restart policy
#   $5... extra docker-run arguments (placed before the image)
#
# --privileged is required by Piston: its job isolation (the isolate sandbox:
# new namespaces and a cgroup for every job, one unprivileged uid per job,
# killing leftover processes) needs capabilities that Docker's default profile
# removes, and write access to /sys/fs/cgroup (which also means the host must use
# cgroup v2 only, as Ubuntu 24.04 does). Because the container is that powerful,
# it is fenced in everywhere else: published on loopback only, memory/swap/pids/
# cpu capped, and no network for jobs (limits.env).
# deploy/escape-tests/run-in-docker.sh checks that those fences hold.
start_piston_container() {
  local name="$1" host_port="$2" volume="$3" restart="$4"
  shift 4
  docker run -d \
    --name "$name" \
    --restart "$restart" \
    --privileged \
    -p "${BIND_ADDR}:${host_port}:2000" \
    -v "${volume}:/piston/packages" \
    --env-file "$LIMITS_ENV" \
    --memory="$CONTAINER_MEMORY" \
    --memory-swap="$CONTAINER_MEMORY_SWAP" \
    --pids-limit="$CONTAINER_PIDS_LIMIT" \
    --cpus="$CONTAINER_CPUS" \
    --log-driver json-file \
    --log-opt "max-size=${LOG_MAX_SIZE}" \
    --log-opt "max-file=${LOG_MAX_FILE}" \
    "$@" \
    "$PISTON_IMAGE" >/dev/null
}

# Waits until GET <api>/api/v2/runtimes answers. Stops early, with the container
# log, if the container exits while we wait.
wait_for_api() { # <api base url> <container> <timeout seconds>
  local api="$1" name="$2" timeout="$3" waited=0 running
  log "waiting up to ${timeout}s for ${api}/api/v2/runtimes"
  until curl -fsS --max-time 3 -o /dev/null "${api}/api/v2/runtimes" 2>/dev/null; do
    running="$(docker inspect --format '{{.State.Running}}' "$name" 2>/dev/null || echo false)"
    if [[ "$running" != "true" ]]; then
      docker logs --tail 40 "$name" >&2 || true
      die "container ${name} stopped while waiting for the Piston API"
    fi
    if (( waited >= timeout )); then
      docker logs --tail 40 "$name" >&2 || true
      die "the Piston API did not answer within ${timeout}s"
    fi
    sleep 2
    waited=$(( waited + 2 ))
  done
  log "API is up"
}

# True when GET /api/v2/runtimes lists <language> at <version>. The JSON is
# flattened and cut into one {...} object per line so both fields must belong to
# the same runtime. (No jq on a stock Ubuntu server image. The last grep has no
# -q on purpose: under pipefail, -q can end the pipe early and flip the result.)
runtime_installed() { # <api base url> <language> <version>
  local body
  body="$(curl -fsS --max-time 10 "${1}/api/v2/runtimes")" || return 1
  printf '%s' "$body" | tr -d '[:space:]' | tr '{' '\n' \
    | grep -F "\"language\":\"${2}\"" | grep -F "\"version\":\"${3}\"" >/dev/null
}

# The install request, printed so that it can be repeated by hand (for example
# when a download failed, or to add a package later).
install_hint() { # <api base url> <package> <version>
  printf "  by hand: curl -sS -X POST %s/api/v2/packages -H 'Content-Type: application/json' -d '{\"language\":\"%s\",\"version\":\"%s\"}'\n" "$1" "$2" "$3" >&2
}

install_package() { # <api base url> <package> <version>
  local tmp code reply
  tmp="$(mktemp)"
  if ! code="$(curl -sS --max-time "$INSTALL_TIMEOUT_S" -o "$tmp" -w '%{http_code}' \
      -X POST -H 'Content-Type: application/json' \
      -d "{\"language\":\"${2}\",\"version\":\"${3}\"}" "${1}/api/v2/packages")"; then
    rm -f "$tmp"
    install_hint "$1" "$2" "$3"
    die "the request to install ${2} ${3} failed (timeout, or the API went away)"
  fi
  reply="$(head -c 300 "$tmp")"
  rm -f "$tmp"
  if [[ "$code" != "200" ]]; then
    install_hint "$1" "$2" "$3"
    die "installing ${2} ${3} failed: HTTP ${code} ${reply}"
  fi
}

# Installs a package unless the runtime it provides is already listed. The
# package name and the runtime language differ for gcc (package "gcc" provides
# the runtime language "c++"), hence the fourth argument.
ensure_package() { # <api base url> <package> <version> <runtime language>
  if runtime_installed "$1" "$4" "$3"; then
    log "package ${2} ${3} already installed"
    return 0
  fi
  log "installing package ${2} ${3} (it is downloaded now; this can take a few minutes)"
  install_package "$1" "$2" "$3"
  runtime_installed "$1" "$4" "$3" \
    || die "installed ${2} ${3}, but runtime '${4} ${3}' is not listed by /api/v2/runtimes"
}

# Docker size string ("640m", "1g") to bytes; Docker uses binary multiples.
to_bytes() { # <size>
  local v="${1,,}" n unit
  n="${v%%[a-z]*}"
  unit="${v#"$n"}"
  case "$unit" in
    ''|b)    echo "$n" ;;
    k|kb)    echo $(( n * 1024 )) ;;
    m|mb)    echo $(( n * 1024 * 1024 )) ;;
    g|gb)    echo $(( n * 1024 * 1024 * 1024 )) ;;
    *)       die "unsupported size '${1}'" ;;
  esac
}

inspect_field() { docker inspect --format "$2" "$1"; }

# Go template for `docker inspect`: one "<container port> -> <host ip>:<host port>"
# line per published binding. The $p and $b are Go template variables, not shell
# ones, which is why they sit in single quotes.
# shellcheck disable=SC2016
PORT_BINDINGS_TEMPLATE='{{range $p, $b := .HostConfig.PortBindings}}{{range $b}}{{$p}} -> {{.HostIp}}:{{.HostPort}}{{"\n"}}{{end}}{{end}}'

check_fact() { # <label> <wanted> <actual>; returns 1 on mismatch
  if [[ "$2" == "$3" ]]; then
    printf '  %-34s %-30s ok\n' "$1" "$3"
  else
    printf '  %-34s %-30s MISMATCH (wanted %s)\n' "$1" "$3" "$2"
    return 1
  fi
}

# Prints the facts that prove the limits are in force and returns 1 if any of
# them differs from the settings above. It only reads (docker inspect), which is
# why run-in-docker.sh can use it on the live container. `docker run` only warns
# (and carries on) when the kernel cannot honour a limit, for example swap
# accounting off, so reading the result back is the only way to know.
check_container_facts() { # <container> <host port> <restart policy>
  local name="$1" port="$2" restart="$3" bad=0 line missing
  local want_mem want_swap want_nano want_ports env_dump
  want_mem="$(to_bytes "$CONTAINER_MEMORY")"
  want_swap="$(to_bytes "$CONTAINER_MEMORY_SWAP")"
  want_nano="$(awk -v c="$CONTAINER_CPUS" 'BEGIN { printf "%d", c * 1000000000 + 0.5 }')"
  want_ports="2000/tcp -> ${BIND_ADDR}:${port}"

  log "docker inspect facts for ${name}:"
  check_fact "State.Status"                running            "$(inspect_field "$name" '{{.State.Status}}')" || bad=1
  check_fact "HostConfig.Privileged"       true               "$(inspect_field "$name" '{{.HostConfig.Privileged}}')" || bad=1
  check_fact "HostConfig.Memory (bytes)"   "$want_mem"        "$(inspect_field "$name" '{{.HostConfig.Memory}}')" || bad=1
  check_fact "HostConfig.MemorySwap"       "$want_swap"       "$(inspect_field "$name" '{{.HostConfig.MemorySwap}}')" || bad=1
  check_fact "HostConfig.PidsLimit"        "$CONTAINER_PIDS_LIMIT" "$(inspect_field "$name" '{{.HostConfig.PidsLimit}}')" || bad=1
  check_fact "HostConfig.NanoCpus"         "$want_nano"       "$(inspect_field "$name" '{{.HostConfig.NanoCpus}}')" || bad=1
  check_fact "HostConfig.RestartPolicy"    "$restart"         "$(inspect_field "$name" '{{.HostConfig.RestartPolicy.Name}}')" || bad=1
  check_fact "Published port binding"      "$want_ports"      "$(inspect_field "$name" "$PORT_BINDINGS_TEMPLATE")" || bad=1
  check_fact "Log driver / rotation"       "json-file ${LOG_MAX_SIZE} x${LOG_MAX_FILE}" \
    "$(inspect_field "$name" '{{.HostConfig.LogConfig.Type}} {{index .HostConfig.LogConfig.Config "max-size"}} x{{index .HostConfig.LogConfig.Config "max-file"}}')" || bad=1

  # Every line of limits.env must really be in the container's environment.
  env_dump="$(inspect_field "$name" '{{range .Config.Env}}{{println .}}{{end}}')"
  missing=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ -z "$line" || "$line" == \#* ]]; then
      continue
    fi
    if ! grep -qxF -- "$line" <<<"$env_dump"; then
      printf '  limits.env line not in container env: %s\n' "$line"
      missing=1
    fi
  done < "$LIMITS_ENV"
  if (( missing == 0 )); then
    printf '  %-34s %-30s ok\n' "limits.env applied" "all lines present"
  else
    bad=1
  fi

  return "$bad"
}

# The same check inside run-piston.sh itself: a difference stops the script.
print_and_verify_facts() { # <container> <host port> <restart policy>
  if ! check_container_facts "$@"; then
    die "${1} is NOT configured as intended (see MISMATCH above). Fix the cause and re-run; if the published port is not ${BIND_ADDR}, run 'docker rm -f ${1}' now."
  fi
  log "all facts match"
}

main() {
  local assume_yes=0
  case "${1:-}" in
    '') ;;
    -y|--yes) assume_yes=1 ;;
    *) die "unknown argument '${1}' (usage: run-piston.sh [--yes])" ;;
  esac
  command -v docker >/dev/null 2>&1 || die "docker CLI not found"
  command -v curl >/dev/null 2>&1 || die "curl not found"
  docker info >/dev/null 2>&1 \
    || die "cannot talk to the Docker daemon (is it running, and is this user in the 'docker' group?)"
  validate_limits_env

  local api="http://${BIND_ADDR}:${HOST_PORT}"
  ensure_volume "$VOLUME_NAME"
  replace_container "$CONTAINER_NAME" "$assume_yes"
  log "starting ${CONTAINER_NAME} from ${PISTON_IMAGE} (published on ${BIND_ADDR}:${HOST_PORT} only)"
  start_piston_container "$CONTAINER_NAME" "$HOST_PORT" "$VOLUME_NAME" "$RESTART_POLICY"
  wait_for_api "$api" "$CONTAINER_NAME" "$STARTUP_TIMEOUT_S"
  ensure_package "$api" python "$PYTHON_VERSION" python
  ensure_package "$api" gcc "$GCC_VERSION" 'c++'
  print_and_verify_facts "$CONTAINER_NAME" "$HOST_PORT" "$RESTART_POLICY"
  log "done: Piston answers on ${api} (loopback only)"
}

# Run main only when executed directly, not when sourced by run-in-docker.sh.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
