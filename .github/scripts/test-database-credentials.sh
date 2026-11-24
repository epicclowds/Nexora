#!/usr/bin/env bash
# CI scenario: database credentials with special characters, password drift
# against an existing volume (the "P1000 Authentication failed" production
# issue), diagnosis and repair without data loss.
#
# Expects a running, initialised stack (verify-deployment.mjs setup was run)
# whose .env uses special-character passwords. Run from the repository root.
set -euo pipefail

base="${1:-http://127.0.0.1:3000}"
env_file() { node .github/scripts/env-file.mjs "$@"; }
step() { echo; echo "▶ $*"; }
fail() { echo "::error::$*"; docker compose logs --no-color --tail 60 backend || true; exit 1; }
used_secrets=("$(env_file get MYSQL_PASSWORD)" "$(env_file get MYSQL_ROOT_PASSWORD)" "$(env_file get REDIS_PASSWORD)")

# Waits until the backend logged the credential diagnosis (since <timestamp>).
expect_diagnosis() {
  local since="$1"
  for _ in $(seq 1 60); do
    if docker compose logs --no-color --since "$since" backend 2>&1 | grep -q 'repair-db-credentials.sh'; then
      docker compose logs --no-color --since "$since" backend 2>&1 | grep -q 'P1000' || fail "diagnosis without the P1000 error"
      echo "  ✔ backend stopped with the credential diagnosis (no retry loop)"
      return 0
    fi
    sleep 3
  done
  fail "the backend did not report the credential problem within 3 minutes"
}

simulate_drift() {
  # A new .env next to the existing volume, as after re-running generate-secrets.sh.
  docker compose stop backend dashboard
  env_file set "$@"
  for pair in "$@"; do used_secrets+=("${pair#*=}"); done
  local since
  since=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  docker compose up -d backend
  expect_diagnosis "$since"
}

step "A: only the application password changed (root password still valid) → online repair"
simulate_drift 'MYSQL_PASSWORD=N3w@pp:p/ss#%?&"A1'
out=$(sh infrastructure/scripts/repair-db-credentials.sh 2>&1) || { echo "$out"; fail "repair (online) failed"; }
echo "$out"
grep -q 'logged in as root' <<<"$out" || fail "expected the online repair path"
docker compose up -d --wait --wait-timeout 180
node infrastructure/scripts/verify-deployment.mjs "$base" check

step "B: application and root password changed → backup + maintenance-mode repair"
simulate_drift 'MYSQL_PASSWORD=B0th@ch:ng/d#%?&"B2' 'MYSQL_ROOT_PASSWORD=R00t@ch:ng/d#%?&"R2'
before=$(ls backups 2>/dev/null | wc -l)
out=$(sh infrastructure/scripts/repair-db-credentials.sh --yes 2>&1) || { echo "$out"; fail "repair (maintenance mode) failed"; }
echo "$out"
grep -q 'Backup written to backups/mnm-before-credential-repair-' <<<"$out" || fail "expected a backup before the repair"
dump=$(ls -t backups/mnm-before-credential-repair-*.sql.gz | head -n 1)
sudo gzip -dc "$dump" | tail -n 1 | grep -q 'Dump completed' || fail "backup $dump is incomplete"
[ "$(ls backups | wc -l)" -gt "$before" ] || fail "no new backup file"
echo "  ✔ backup $dump is complete"
docker compose up -d --wait --wait-timeout 180
node infrastructure/scripts/verify-deployment.mjs "$base" check

step "C: generate-secrets.sh refuses to create new passwords next to the existing volume"
mv .env .env.keep
if sh infrastructure/scripts/generate-secrets.sh 2>guard.txt; then mv .env.keep .env; fail "generate-secrets.sh created secrets for an existing volume"; fi
mv .env.keep .env
grep -q 'existing Nexora database volume' guard.txt || { cat guard.txt; fail "unexpected generate-secrets.sh message"; }
echo "  ✔ refused with an explanation"
rm -f guard.txt

step "D: no password appears in any container log"
logs=$(docker compose logs --no-color 2>&1)
for secret in "${used_secrets[@]}"; do
  if grep -qF -- "$secret" <<<"$logs"; then fail "a database/Redis password was written to the container logs"; fi
done
echo "  ✔ checked ${#used_secrets[@]} passwords against $(wc -l <<<"$logs") log lines"
echo
echo "✅ Database credential handling verified."
