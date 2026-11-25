#!/usr/bin/env bash
# Standalone installation test, as a new user (or Portainer/Arcane) would do it:
# an empty folder with nothing but docker-compose.yml, environment variables and
# the published images. Also adopts an installation made with the previous
# docker-compose.yml (v1.1.0) and checks that its data is kept.
#
#   bash .github/scripts/test-standalone.sh   (from the repository root, CI only)
#
# Creates and finally DELETES the minecraft-network-manager_* volumes – never
# run it on a machine with a real Nexora installation.
set -euo pipefail

repo=$(pwd)
work="${RUNNER_TEMP:-/tmp}/nexora-standalone"
url=http://127.0.0.1:3000
previous_tag=v1.1.0
export VERIFY_STATE="$work/verify-state.json" VERIFY_PLAYERS=50

log="${RUNNER_TEMP:-/tmp}/nexora-standalone.log"
: > "$log"
exec > >(tee -a "$log") 2>&1
current_step=
step() { current_step="$*"; printf '\n▶ %s\n' "$*"; }
ok() { printf '  ✔ %s\n' "$*"; }
reason=
# GitHub annotations are readable without signing in (unlike job logs), so a
# failure is reported there with its context. Usage: annotate <title> <text>
annotate() {
  local title body
  title=$(printf '%s' "$1" | sed 's/%/%25/g; s/:/%3A/g; s/,/%2C/g')
  body=$(printf '%s\n' "$2" | sed 's/%/%25/g; s/\r/%0D/g' | awk '{printf "%s%%0A", $0}')
  echo "::error title=${title}::${body}"
}
fail() { printf '  ✖ %s\n' "$*" >&2; reason="$*"; trap - ERR; exit 1; }
trap 'reason="line $LINENO: $BASH_COMMAND"' ERR
verify() { node "$repo/infrastructure/scripts/verify-deployment.mjs" "$url" "$@"; }
volumes() { docker volume ls --format '{{.Name}}' | grep '^minecraft-network-manager_' | sort | tr '\n' ' '; }
show_logs() {
  echo "── container logs ──"
  for args in "-p nexora --env-file stack.env --profile https" "" "-f old.yml"; do
    # shellcheck disable=SC2086
    docker compose $args logs --no-color --tail 150 2>/dev/null || true
  done
}
cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    script_output=$(tail -n 50 "$log" 2>/dev/null || true)
    if cd "$work" 2>/dev/null; then
      show_logs > "$work/containers.log" 2>&1 || true
      cat "$work/containers.log"
    fi
    annotate "Standalone test failed in step: ${current_step:-setup}" "${reason:-exit status $status}"$'\n\n'"${script_output}"
    annotate "Standalone test – container logs" "$(grep -v '^ *$' "$work/containers.log" 2>/dev/null | tail -n 120 || true)"
  fi
  cd "$work" 2>/dev/null || return 0
  docker compose -p nexora --env-file stack.env --profile https down -v --remove-orphans >/dev/null 2>&1 || true
  docker compose down -v --remove-orphans >/dev/null 2>&1 || true
  docker compose -f old.yml down -v --remove-orphans >/dev/null 2>&1 || true
  for v in $(volumes); do docker volume rm "$v" >/dev/null 2>&1 || true; done
}

if [ -n "$(volumes)" ]; then fail "Nexora volumes already exist on this machine: $(volumes)"; fi
rm -rf "$work"
mkdir -p "$work"
cp docker-compose.yml "$work/docker-compose.yml"   # the only file a user needs
git show "$previous_tag:docker-compose.yml" > "$work/old.yml"
cd "$work"
trap cleanup EXIT

step "1: Missing required variables are reported before anything starts"
if docker compose config >/dev/null 2>missing.txt; then fail "docker compose config succeeded without any secrets"; fi
grep -Eq '(MYSQL_PASSWORD|MYSQL_ROOT_PASSWORD|REDIS_PASSWORD|JWT_SECRET) is required' missing.txt || { cat missing.txt; fail "unclear error message"; }
ok "$(head -n 1 missing.txt)"

step "2: Static checks of the standalone file"
# Passwords with characters that break naive connection URLs.
cat > .env <<EOF
MYSQL_PASSWORD='Db@pa:ss/w#rd%?&$(openssl rand -hex 6)'
MYSQL_ROOT_PASSWORD='Ro@ot:pa/ss#%?&$(openssl rand -hex 6)'
REDIS_PASSWORD='Re@dis:pa/ss#%?&$(openssl rand -hex 6)'
JWT_SECRET=$(openssl rand -hex 32)
SETUP_TOKEN=ci-standalone-$(openssl rand -hex 12)
DASHBOARD_BIND=127.0.0.1
EOF
export SETUP_TOKEN
SETUP_TOKEN=$(sed -n 's/^SETUP_TOKEN=//p' .env)
docker compose config --quiet
docker compose --profile https config --quiet
config=$(docker compose config)
if grep -Eq '^ *build:' <<<"$config"; then fail "the stack builds images"; fi
if docker compose config --format json | node -e '
  const c = JSON.parse(require("fs").readFileSync(0, "utf8"));
  const binds = Object.entries(c.services).flatMap(([s, d]) => (d.volumes ?? []).filter((v) => v.type === "bind").map((v) => `${s}: ${v.source}`));
  if (binds.length) { console.error(binds.join("\n")); process.exit(0); }
  process.exit(1);
'; then fail "host paths are mounted by default"; fi
for svc in mysql redis backend; do
  if docker compose config --format json | node -e "process.exit(JSON.parse(require('fs').readFileSync(0,'utf8')).services['$svc'].ports?.length ? 0 : 1)"; then fail "$svc publishes a port"; fi
done
grep -q 'image: ghcr.io/epicclowds/nexora/backend:latest' <<<"$config" || fail "backend does not default to the latest image"
grep -q 'image: ghcr.io/epicclowds/nexora/dashboard:latest' <<<"$config" || fail "dashboard does not default to the latest image"
ok "no build, no host paths, only the dashboard port is published, images default to latest"

step "3: Existing installation made with the previous docker-compose.yml ($previous_tag)"
docker compose -f old.yml pull --quiet
docker compose -f old.yml up -d --wait --wait-timeout 300
grep -q '"initialized":false' <<<"$(curl -fsS "$url/api/setup/status")" || fail "setup wizard is not offered on a fresh installation"
curl -fsS -o /dev/null "$url/setup" || fail "setup page not reachable"
ok "fresh installation offers the setup wizard"
verify setup
docker compose -f old.yml down
before=$(volumes)
ok "previous installation initialised and stopped (volumes: $before)"

step "4: The same folder switches to the standalone file (docker compose pull / up -d)"
docker compose pull --quiet
docker compose up -d --wait --wait-timeout 300 2>up.txt || { cat up.txt; fail "stack did not become healthy"; }
cat up.txt
if grep -qi 'data will be lost' up.txt; then fail "Compose wants to recreate a volume"; fi
verify check
ok "existing data is still there"
[ "$(docker volume ls --format '{{.Name}}' | grep -c 'mysql-data')" = 1 ] || fail "a second database volume was created: $(docker volume ls --format '{{.Name}}' | grep mysql-data | tr '\n' ' ')"
before=$(volumes)   # now including the (empty) GeoIP volume of the new file
ok "no new database volume (volumes: $before)"
for port in 3306 6379 4000; do
  if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then fail "port $port is reachable from the host"; fi
done
ok "MySQL, Redis and the backend are not reachable from the host"

step "5: Restart keeps data"
docker compose restart
docker compose up -d --wait --wait-timeout 180
verify check

step "6: Redeploy as a differently named stack with an env file (as Portainer/Arcane do)"
docker compose down
mv .env stack.env
docker compose -p nexora --env-file stack.env up -d --wait --wait-timeout 300
verify check
[ "$(volumes)" = "$before" ] || fail "volumes changed: $(volumes) (expected $before)"
ok "stack 'nexora' uses the existing volumes and data"

step "7: Pinned version and switching back to latest"
version=${previous_tag#v}
NEXORA_VERSION=$version docker compose -p nexora --env-file stack.env up -d --wait --wait-timeout 300
docker compose -p nexora --env-file stack.env images backend dashboard
grep -q "\"Tag\":\"$version\"" <<<"$(docker compose -p nexora --env-file stack.env images backend --format json)" || fail "pinned version not used"
docker compose -p nexora --env-file stack.env pull --quiet
docker compose -p nexora --env-file stack.env up -d --wait --wait-timeout 300
grep -q '"Tag":"latest"' <<<"$(docker compose -p nexora --env-file stack.env images backend --format json)" || fail "latest not used"
verify check
ok "NEXORA_VERSION=$version pins the images; removing it returns to latest; data kept"

step "8: Wrong database password is diagnosed (and nothing secret is logged)"
MYSQL_PASSWORD=ci-wrong-password-0000 docker compose -p nexora --env-file stack.env up -d --no-deps backend
diagnosed=
for _ in $(seq 1 30); do
  if grep -q 'MySQL rejected the credentials' <<<"$(docker compose -p nexora --env-file stack.env logs backend 2>/dev/null)"; then diagnosed=1; break; fi
  sleep 3
done
logs=$(docker compose -p nexora --env-file stack.env logs --no-color 2>/dev/null)
[ -n "$diagnosed" ] || { tail -n 40 <<<"$logs"; fail "no P1000 diagnosis in the backend log"; }
set -f   # the passwords contain glob characters
for secret in ci-wrong-password-0000 $(sed -n "s/^\(MYSQL_PASSWORD\|MYSQL_ROOT_PASSWORD\|REDIS_PASSWORD\|JWT_SECRET\)=//p" stack.env | tr -d "'"); do
  if grep -qF -- "$secret" <<<"$logs"; then fail "a secret appears in the container logs"; fi
done
set +f
docker compose -p nexora --env-file stack.env up -d --wait --wait-timeout 300
verify check
ok "P1000 explained without secrets; correct password restores service; data kept"

step "9: Built-in HTTPS profile (no Caddyfile on the host)"
cat >> stack.env <<EOF
DASHBOARD_DOMAIN=localhost
ACME_EMAIL=ci@example.com
EOF
docker compose -p nexora --env-file stack.env --profile https up -d --wait --wait-timeout 180
served=
for _ in $(seq 1 30); do
  if curl -fsSk -D headers.txt -o /dev/null --resolve localhost:443:127.0.0.1 https://localhost/login; then served=1; break; fi
  sleep 2
done
[ -n "$served" ] || { docker compose -p nexora --env-file stack.env logs caddy | tail -n 30; fail "Caddy does not serve the dashboard over HTTPS"; }
grep -qi '^strict-transport-security' headers.txt || fail "HSTS header missing"
ok "Caddy serves https://localhost with HSTS"

printf '\n✅ Standalone deployment verified.\n'
