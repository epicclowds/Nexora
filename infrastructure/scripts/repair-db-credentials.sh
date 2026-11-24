#!/bin/sh
# Repairs "Prisma P1000: Authentication failed" without losing data: makes the
# MySQL accounts inside the existing data volume match the passwords in .env.
#
#   sh infrastructure/scripts/repair-db-credentials.sh [--yes]
#
# Why this happens: MySQL stores its passwords in the data volume when the
# volume is first created. A new or edited .env (e.g. generate-secrets.sh run
# again, or a new installation folder next to an existing volume) does not
# change them.
#
# What it does – least invasive first, never deletes volumes or data:
#   1. If the application user can already log in: nothing to do.
#   2. If the root password in .env works: update the application user online.
#   3. Otherwise (both passwords changed): stop backend, dashboard and MySQL,
#      start MySQL once in maintenance mode, write a backup of the database to
#      backups/, set root and application user passwords to the .env values,
#      then start everything again. Asks for confirmation unless --yes is given.
#
# Passwords are never printed.
set -eu

cd "$(dirname "$0")/../.."
[ -f .env ] || { echo "No .env in $(pwd). Run this from your Nexora folder." >&2; exit 1; }
yes=false
[ "${1:-}" = "--yes" ] && yes=true
script=infrastructure/scripts/mysql-credentials.sh

echo "[repair] Starting MySQL (if not running)…"
docker compose up -d --wait mysql

if docker compose exec -T mysql sh -s check-app < "$script"; then
  echo "[repair] The database user already accepts the password from .env – nothing to repair."
  echo "[repair] If the backend still fails, check: docker compose logs backend"
  exit 0
fi
echo "[repair] The database user rejects the password from .env."

status=0
docker compose exec -T mysql sh -s online < "$script" || status=$?
if [ "$status" -eq 0 ]; then
  :
elif [ "$status" -eq 3 ]; then
  echo
  echo "[repair] The root password in .env does not match the volume either."
  echo "[repair] Next step: stop backend, dashboard and MySQL for about a minute, back up the"
  echo "[repair] database to backups/, and set the root and application passwords to the values"
  echo "[repair] in .env. No data is deleted."
  if ! $yes; then
    printf '[repair] Continue? [y/N] '
    read -r answer
    case "$answer" in y | Y | yes | YES) ;; *) echo "[repair] Aborted; nothing was changed."; exit 1 ;; esac
  fi
  mkdir -p backups
  chmod 700 backups 2>/dev/null || true
  dump="mnm-before-credential-repair-$(date +%Y%m%d-%H%M%S).sql.gz"
  docker compose stop backend dashboard
  docker compose stop mysql
  docker compose run --rm --no-deps -T \
    -v "$(pwd)/backups:/backups" \
    -v "$(pwd)/$script:/tmp/mysql-credentials.sh:ro" \
    --entrypoint sh mysql /tmp/mysql-credentials.sh offline "/backups/$dump"
  echo "[repair] Backup written to backups/$dump"
  docker compose up -d --wait mysql
else
  echo "[repair] Repair failed (exit code $status); nothing else was changed." >&2
  exit "$status"
fi

if ! docker compose exec -T mysql sh -s check-app < "$script"; then
  echo "[repair] The database user still rejects the password – please report this." >&2
  exit 1
fi
echo "[repair] Database credentials match .env again. Starting Nexora…"
docker compose up -d
echo "[repair] Done. Check with: docker compose ps   (backend and dashboard become healthy within a minute)"
