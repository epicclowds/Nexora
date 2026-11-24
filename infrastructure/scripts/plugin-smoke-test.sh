#!/usr/bin/env bash
# Starts a real Velocity or Paper server with the Nexora plugin and checks that
# the plugin loads – and, with a backend, registers and connects.
#
#   plugin-smoke-test.sh <velocity|paper> <server-version> <plugin.jar> [backend-url] [registration-token]
#
# The server jar comes from the official PaperMC download API (SHA-256
# verified). For Paper, the Minecraft EULA is accepted for this throwaway test
# server only (eula.txt) – required to start it at all.
#
# Fails fast: the server process is watched continuously, so a crash or an
# early exit fails immediately with its exit code and log. Every phase has its
# own timeout (seconds, overridable): SMOKE_START_TIMEOUT (180),
# SMOKE_REGISTER_TIMEOUT (60), SMOKE_STOP_TIMEOUT (60).
set -euo pipefail

platform="${1:?platform}"; mc_version="${2:?server version}"; jar="$(realpath "${3:?plugin jar}")"; backend="${4:-}"; token="${5:-}"
work="${SMOKE_WORKDIR:-$(mktemp -d)}/$platform-$mc_version"
start_timeout="${SMOKE_START_TIMEOUT:-180}"
register_timeout="${SMOKE_REGISTER_TIMEOUT:-60}"
stop_timeout="${SMOKE_STOP_TIMEOUT:-60}"
log() { echo "[smoke $platform $mc_version] $*"; }
rm -rf "$work"
mkdir -p "$work/plugins"
cd "$work"

# Velocity rejects unknown options (e.g. Paper's --nogui) and exits immediately.
case "$platform" in
  velocity) data_dir="plugins/networkmanager"; stop_cmd="shutdown"; server_args=() ;;
  paper) data_dir="plugins/NetworkManager"; stop_cmd="stop"; server_args=(--nogui) ;;
  *) echo "Unknown platform '$platform' (velocity|paper)" >&2; exit 2 ;;
esac
[ -s "$jar" ] || { echo "Plugin jar '$jar' is missing or empty" >&2; exit 2; }

log "Downloading the server"
build=$(curl -fsSL --retry 3 --max-time 60 -H 'User-Agent: nexora-ci' "https://fill.papermc.io/v3/projects/$platform/versions/$mc_version/builds/latest")
url=$(node -e 'console.log(JSON.parse(process.argv[1]).downloads["server:default"].url)' "$build")
sha=$(node -e 'console.log(JSON.parse(process.argv[1]).downloads["server:default"].checksums.sha256)' "$build")
build_id=$(node -e 'console.log(JSON.parse(process.argv[1]).id)' "$build")
curl -fsSL --retry 3 --max-time 300 -H 'User-Agent: nexora-ci' -o server.jar "$url"
echo "$sha  server.jar" | sha256sum -c --quiet -
log "Server build $build_id downloaded and verified"

cp "$jar" plugins/
if [ -n "$backend" ]; then
  mkdir -p "$data_dir"
  printf 'backend-url=%s\nregistration-token=%s\n' "$backend" "$token" > "$data_dir/config.properties"
fi
if [ "$platform" = "paper" ]; then
  echo "eula=true" > eula.txt
  printf 'online-mode=false\nserver-port=25566\nlevel-type=minecraft\\:flat\ngenerate-structures=false\nview-distance=2\nsimulation-distance=2\nspawn-protection=0\n' > server.properties
fi

# Console: a FIFO held open read-write on fd 3, so writing a command never
# blocks – not even after the server has exited.
mkfifo console
exec 3<>console
java -Xms512M -Xmx1536M -jar server.jar "${server_args[@]}" < console > server.log 2>&1 &
server=$!
trap 'kill -9 "$server" 2>/dev/null || true; exec 3>&-' EXIT

plugin_lines() { grep -iE 'networkmanager|network manager|dev\.mnm' server.log | tail -n "${1:-40}" || true; }
fail() {
  log "FAILED: $*"
  if kill -0 "$server" 2>/dev/null; then
    printf '%s\n' "$stop_cmd" >&3 || true
    sleep 5
    kill -9 "$server" 2>/dev/null || true
  fi
  echo "----- plugin log lines -----"; plugin_lines 40
  echo "----- last 80 lines of server.log ($work/server.log) -----"; tail -n 80 server.log || true
  if [ -n "${GITHUB_ACTIONS:-}" ]; then
    # Annotations are visible on the run page (and via the API) without opening the log.
    local excerpt
    excerpt=$( { grep -E "$PLUGIN_ERRORS|ERROR|Exception|Caused by" server.log | head -n 12; plugin_lines 8; } | cut -c1-240 | sed -e 's/%/%25/g' | awk 'BEGIN{ORS="%0A"} {print}')
    echo "::error title=Smoke test $platform $mc_version failed::$*%0A$excerpt"
  fi
  exit 1
}

# Patterns that mean the plugin is broken – checked while waiting, not only at the end.
PLUGIN_ERRORS='Error occurred while enabling NetworkManager|Could not load .*Nexora|(NoClassDefFoundError|ClassNotFoundException):? (dev[./]mnm|com[./]google[./]gson|org[./]yaml|net[./]kyori|org[./]slf4j)|at dev\.mnm\.|dev\.mnm\.[A-Za-z.]+(Exception|Error)'

# wait_for <description> <regex> <timeout-seconds>
wait_for() {
  local what="$1" pattern="$2" limit="$3" started=$SECONDS
  log "Waiting for $what (max ${limit}s)"
  while ! grep -Eq "$pattern" server.log; do
    if ! kill -0 "$server" 2>/dev/null; then
      local code=0
      wait "$server" || code=$?
      fail "the server exited unexpectedly (exit code $code) while waiting for $what"
    fi
    if grep -Eq "$PLUGIN_ERRORS" server.log; then fail "the plugin reported an error while waiting for $what"; fi
    local elapsed=$((SECONDS - started))
    if [ "$elapsed" -ge "$limit" ]; then fail "timeout after ${limit}s waiting for $what"; fi
    if [ $((elapsed % 15)) -eq 0 ] && [ "$elapsed" -gt 0 ]; then log "  … ${elapsed}s, last line: $(tail -n 1 server.log | cut -c1-160)"; fi
    sleep 1
  done
  log "OK: $what ($((SECONDS - started))s)"
}

if [ "$platform" = "paper" ]; then
  wait_for "the plugin to be enabled" 'Enabling NetworkManager' "$start_timeout"
else
  wait_for "the plugin to be loaded" 'Loaded plugin networkmanager' "$start_timeout"
fi
wait_for "the server to finish starting" 'Done \(' "$start_timeout"
if [ -n "$backend" ]; then
  wait_for "registration with the backend" 'Registered with the backend as' "$register_timeout"
  wait_for "the first successful heartbeat" 'Connected to the backend' "$register_timeout"
fi

# Graceful stop also exercises the plugin's shutdown path (pending events, offline notice).
log "Stopping the server"
printf '%s\n' "$stop_cmd" >&3
stopped=false
for _ in $(seq 1 "$stop_timeout"); do
  if ! kill -0 "$server" 2>/dev/null; then stopped=true; break; fi
  sleep 1
done
$stopped || fail "the server did not stop within ${stop_timeout}s"
if grep -Eq "$PLUGIN_ERRORS" server.log; then fail "the plugin reported an error during shutdown"; fi

echo "----- plugin log lines -----"; plugin_lines 20
log "✅ plugin started$([ -n "$backend" ] && echo ', registered and connected'), server stopped cleanly"
