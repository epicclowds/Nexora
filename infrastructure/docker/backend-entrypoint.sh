#!/bin/sh
# Builds the database/Redis connection URLs, applies pending database
# migrations, then starts the backend.
# Migrations are forward-only; take a backup before upgrading (docs/installation/backup-restore.md).
# Never print DATABASE_URL, REDIS_URL or passwords: they end up in `docker compose logs`.
set -eu

# Connection URLs from separate settings (docker-compose.yml). Every part is
# percent-encoded, so passwords may contain characters such as @ : / # % ?.
# An explicitly configured DATABASE_URL / REDIS_URL takes precedence.
if [ -z "${DATABASE_URL:-}" ] && [ -n "${DATABASE_PASSWORD+set}" ]; then
  DATABASE_URL=$(node -e '
    const e = process.env, q = encodeURIComponent;
    process.stdout.write(`mysql://${q(e.DATABASE_USER ?? "")}:${q(e.DATABASE_PASSWORD ?? "")}@${e.DATABASE_HOST ?? "mysql"}:${e.DATABASE_PORT ?? "3306"}/${q(e.DATABASE_NAME ?? "")}`);
  ')
  export DATABASE_URL
fi
if [ -z "${REDIS_URL:-}" ] && [ -n "${REDIS_PASSWORD+set}" ]; then
  REDIS_URL=$(node -e '
    const e = process.env;
    process.stdout.write(`redis://:${encodeURIComponent(e.REDIS_PASSWORD ?? "")}@${e.REDIS_HOST ?? "redis"}:${e.REDIS_PORT ?? "6379"}`);
  ')
  export REDIS_URL
fi
unset DATABASE_PASSWORD REDIS_PASSWORD

credentials_hint() {
  cat >&2 <<EOF
[entrypoint] ────────────────────────────────────────────────────────────────
[entrypoint] MySQL rejected the credentials of database user "${DATABASE_USER:-?}" (Prisma P1000).
[entrypoint] MySQL stores its passwords in the data volume when the volume is first created.
[entrypoint] Changing MYSQL_PASSWORD / MYSQL_ROOT_PASSWORD in .env later does NOT change them,
[entrypoint] e.g. after running generate-secrets.sh again or using a new .env with an existing volume.
[entrypoint] Your data is untouched. Fix it without data loss (do NOT delete volumes):
[entrypoint]   1. Put the previous passwords back into .env (from your old .env or a backup), or
[entrypoint]   2. run: sh infrastructure/scripts/repair-db-credentials.sh
[entrypoint] Guide: https://github.com/epicclowds/Nexora/blob/main/docs/installation/README.md#database-password-mismatch-p1000
[entrypoint] ────────────────────────────────────────────────────────────────
EOF
}

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "[entrypoint] Applying database migrations…"
  attempt=1
  max_attempts="${MIGRATION_MAX_ATTEMPTS:-10}"
  while :; do
    status=0
    output=$(npx --no-install prisma migrate deploy 2>&1) || status=$?
    printf '%s\n' "$output"
    [ "$status" -eq 0 ] && break
    # Wrong credentials never fix themselves: stop right away with instructions.
    if printf '%s' "$output" | grep -Eq 'P1000|Authentication failed against database server|Access denied for user'; then
      credentials_hint
      exit 1
    fi
    if [ "$attempt" -ge "$max_attempts" ]; then
      echo "[entrypoint] Migrations failed after $attempt attempts. Refusing to start." >&2
      exit 1
    fi
    echo "[entrypoint] Database not ready (attempt $attempt/$max_attempts). Retrying in 5s…" >&2
    attempt=$((attempt + 1))
    sleep 5
  done
fi

exec "$@"
