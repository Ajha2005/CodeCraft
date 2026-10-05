#!/usr/bin/env bash
# =============================================================================
# restore-db.sh: put a backup made by backup-db.sh back, replacing the database.
#
#   deploy/restore-db.sh <backup.dump> [--yes]
#
# The way back from a release that went wrong (RUNBOOK.md, section 3). It REPLACES
# every table in the `public` schema of the database named in /etc/codecraft/backend.env
# with what is in the backup: rows written since the backup are lost, and tables a
# later migration created are dropped. Stop the backend first.
#
# It does, in this order:
#   1. checks the file is a real CodeCraft backup,
#   2. shows which database it is about to replace and makes you type its name
#      (--yes skips the question, for a terminal-less ssh session),
#   3. drops every table in `public` (CASCADE, so foreign keys that a newer migration
#      added to old tables cannot block the restore),
#   4. restores the backup in ONE transaction, without its `CREATE SCHEMA public` line
#      (the schema is still there; its grants stay as they are),
#   5. prints the row counts to compare with the ones backup-db.sh printed.
# If step 4 fails nothing half-restored is left behind, but the tables are gone: fix
# the cause and run this script again; the backup file is never touched.
#
# To rehearse on another database, point CODECRAFT_ENV_FILE at a file that names it.
# Same client container as backup-db.sh (PG_CLIENT_IMAGE, default postgres:17-alpine).
# =============================================================================

# The `sh -c '...'` strings below are single-quoted on purpose: $DATABASE_URL must be expanded by the
# shell INSIDE the throwaway container (where only the variable is passed in), never by this one.
# shellcheck disable=SC2016
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE="${PG_CLIENT_IMAGE:-postgres:17-alpine}"
DUMP=""
ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    --yes) ASSUME_YES=1 ;;
    -*) echo "unknown option: $arg" >&2; exit 2 ;;
    *)
      if [ -n "$DUMP" ]; then echo "only one backup file, please" >&2; exit 2; fi
      DUMP="$arg"
      ;;
  esac
done
[ -n "$DUMP" ] || { echo "usage: $0 <backup.dump> [--yes]" >&2; exit 2; }
[ -r "$DUMP" ] || { echo "cannot read $DUMP" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "docker is not installed (or this user is not in the docker group)" >&2; exit 1; }

# 1. Is it a real backup?
LISTING="$(docker run --rm -i "$IMAGE" pg_restore --list < "$DUMP" 2>/dev/null)" || LISTING=""
TABLE_DATA="$(printf '%s\n' "$LISTING" | grep -c ' TABLE DATA public ' || true)"
if [ "$TABLE_DATA" -lt 5 ] || ! printf '%s\n' "$LISTING" | grep -q ' TABLE DATA public territory_cells '; then
  echo "$DUMP does not look like a CodeCraft backup (data for $TABLE_DATA tables). Nothing was changed." >&2
  exit 1
fi

# 2. Which database? (host, port and name only: never the user or the password)
TARGET="$("$HERE/with-prod-env.sh" node -e 'const u = new URL(process.env.DATABASE_URL); console.log(`${u.hostname}:${u.port || 5432}${u.pathname}`)')"
DB_NAME="${TARGET##*/}"
echo "About to REPLACE all tables in the public schema of:  $TARGET"
echo "with the contents of:                                $DUMP"
echo "Everything written since that backup is lost. The backend must be stopped (pm2 stop codecraft-backend)."
if [ "$ASSUME_YES" -ne 1 ]; then
  [ -t 0 ] || { echo "No terminal to ask on: run it from a terminal, or add --yes." >&2; exit 1; }
  read -r -p "Type the database name ($DB_NAME) to go on: " ANSWER
  [ "$ANSWER" = "$DB_NAME" ] || { echo "Not the same. Nothing was changed." >&2; exit 1; }
fi

# 3. Empty the public schema's tables.
echo "Dropping the tables ..."
"$HERE/with-prod-env.sh" docker run --rm -i -e DATABASE_URL "$IMAGE" \
  sh -c 'exec psql "$DATABASE_URL" --no-psqlrc --quiet -v ON_ERROR_STOP=1' <<'SQL'
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', t);
  END LOOP;
END $$;
SQL

# 4. Restore, all or nothing. The `SCHEMA public` lines are left out of the contents list: the schema exists.
echo "Restoring ..."
if ! "$HERE/with-prod-env.sh" docker run --rm -i -e DATABASE_URL "$IMAGE" sh -c '
  set -e
  cat > /tmp/backup.dump
  pg_restore --list /tmp/backup.dump | grep -vE " (COMMENT - )?SCHEMA( -)? public " > /tmp/contents.list
  exec pg_restore --use-list=/tmp/contents.list --single-transaction --no-owner --no-privileges --dbname "$DATABASE_URL" /tmp/backup.dump
' < "$DUMP"; then
  echo "The restore FAILED and the tables are gone. The backup file is untouched: fix the cause above and run this again." >&2
  exit 1
fi

# 5. Numbers to compare with the backup.
echo
echo "Restored. Rows now (compare with what backup-db.sh printed):"
"$HERE/with-prod-env.sh" docker run --rm -i -e DATABASE_URL "$IMAGE" \
  sh -c 'exec psql "$DATABASE_URL" --no-psqlrc --quiet --tuples-only --no-align --field-separator "  "' <<'SQL'
SELECT 'users', count(*) FROM "User"
UNION ALL SELECT 'submissions', count(*) FROM submissions
UNION ALL SELECT 'cells (all)', count(*) FROM territory_cells
UNION ALL SELECT 'open cell ownerships', count(*) FROM territory_cell_ownerships WHERE "closedAt" IS NULL
UNION ALL SELECT 'contests', count(*) FROM contests;
SQL
