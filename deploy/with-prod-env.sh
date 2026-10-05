#!/usr/bin/env bash
# =============================================================================
# with-prod-env.sh: run one command with the production settings loaded.
#
#   deploy/with-prod-env.sh <command> [args...]
#   e.g.  cd backend && ../deploy/with-prod-env.sh npx prisma migrate deploy
#         cd backend && ../deploy/with-prod-env.sh npm run regrid
#
# The settings live in /etc/codecraft/backend.env (override the path with
# CODECRAFT_ENV_FILE). They are read by Node's own --env-file parser, the very
# same one pm2 uses to start the backend, so a command run through this script
# sees exactly the values the server sees. Nothing is printed, and nothing is
# `source`d into your shell (a password with a `$` or `&` in it would break that).
#
# Why not a backend/.env file? Because there must not be one on the server: the
# backend also loads it with dotenv and it could silently fill gaps in the real
# file (see deploy/pm2/ecosystem.config.cjs).
# =============================================================================
set -euo pipefail

ENV_FILE="${CODECRAFT_ENV_FILE:-/etc/codecraft/backend.env}"

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <command> [args...]" >&2
  exit 2
fi
if [ ! -r "$ENV_FILE" ]; then
  echo "Cannot read $ENV_FILE (set CODECRAFT_ENV_FILE to use another file, or run as a user that may read it)." >&2
  exit 1
fi

# Node loads the file into process.env, then runs the command with that environment.
exec node --env-file="$ENV_FILE" -e '
const { spawnSync } = require("node:child_process");
const [command, ...args] = process.argv.slice(1);
const result = spawnSync(command, args, { stdio: "inherit" });
if (result.error) { console.error(result.error.message); process.exit(127); }
process.exit(result.status ?? 1);
' -- "$@"
