#!/usr/bin/env bash
# =============================================================================
# backup-db.sh: take a pg_dump of the production database before a release.
#
#   deploy/backup-db.sh [output-dir]        default output-dir: ~/codecraft-backups
#
# Writes <output-dir>/codecraft-YYYYMMDD-HHMMSS.dump (custom format, the `public`
# schema only, no owners or privileges, so it restores into any Postgres), mode 600,
# then proves it is a real archive by listing its contents, and prints how many rows
# the main tables held so you can compare after the release.
#
# The connection string comes from /etc/codecraft/backend.env through
# deploy/with-prod-env.sh, the same way the backend gets it, and goes to a throwaway
# postgres client container as an environment variable. It is never printed. (It is
# an argument of pg_dump inside that container for the few seconds the dump runs, so
# anyone who can run `ps` on the box could see it then: fine on a box with one login.)
#
# Why a container: pg_dump refuses to talk to a server newer than itself, and the
# version Ubuntu ships is older than Supabase's. If Supabase moves up, run with
# PG_CLIENT_IMAGE=postgres:18-alpine (use the server's major version or newer).
#
# Stop the backend first (RUNBOOK.md does) so the dump is a still picture.
# =============================================================================

# The `sh -c '...'` strings below are single-quoted on purpose: $DATABASE_URL must be expanded by the
# shell INSIDE the throwaway container, never by this one.
# shellcheck disable=SC2016
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="${1:-$HOME/codecraft-backups}"
IMAGE="${PG_CLIENT_IMAGE:-postgres:17-alpine}"

command -v docker >/dev/null 2>&1 || { echo "docker is not installed (or this user is not in the docker group)" >&2; exit 1; }

umask 077
mkdir -p "$OUT_DIR"
OUT="$OUT_DIR/codecraft-$(date -u +%Y%m%d-%H%M%S).dump"
PARTIAL="$OUT.partial"
trap 'rm -f "$PARTIAL"' EXIT

echo "Dumping the public schema (client image: $IMAGE) ..."
"$HERE/with-prod-env.sh" docker run --rm -e DATABASE_URL "$IMAGE" \
  sh -c 'exec pg_dump --format=custom --schema=public --no-owner --no-privileges "$DATABASE_URL"' \
  > "$PARTIAL"

# A dump of the wrong database, or of an emptied one, is "valid" but useless: look inside.
LISTING="$(docker run --rm -i "$IMAGE" pg_restore --list < "$PARTIAL")"
TABLE_DATA="$(printf '%s\n' "$LISTING" | grep -c ' TABLE DATA public ' || true)"
if [ "$TABLE_DATA" -lt 5 ]; then
  echo "The dump holds data for only $TABLE_DATA tables; this does not look like the CodeCraft database. Not keeping it." >&2
  exit 1
fi
printf '%s\n' "$LISTING" | grep -q ' TABLE DATA public territory_cells ' \
  || { echo "The dump has no territory_cells data. Not keeping it." >&2; exit 1; }

mv "$PARTIAL" "$OUT"
chmod 600 "$OUT"
trap - EXIT

echo
echo "Backup:  $OUT"
echo "Size:    $(du -h "$OUT" | cut -f1)    tables with data: $TABLE_DATA"
echo "SHA-256: $(sha256sum "$OUT" | cut -d' ' -f1)"
echo
echo "Rows now (write these down; the checks after the release compare against them):"
"$HERE/with-prod-env.sh" docker run --rm -i -e DATABASE_URL "$IMAGE" \
  sh -c 'exec psql "$DATABASE_URL" --no-psqlrc --quiet --tuples-only --no-align --field-separator "  "' <<'SQL'
SELECT 'users', count(*) FROM "User"
UNION ALL SELECT 'submissions', count(*) FROM submissions
UNION ALL SELECT 'cells (all)', count(*) FROM territory_cells
UNION ALL SELECT 'open cell ownerships', count(*) FROM territory_cell_ownerships WHERE "closedAt" IS NULL
UNION ALL SELECT 'contests', count(*) FROM contests;
SQL
