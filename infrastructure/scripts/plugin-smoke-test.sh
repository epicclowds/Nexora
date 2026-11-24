#!/usr/bin/env bash
# Starts a real Velocity or Paper server with the Nexora plugin and checks that
# the plugin loads (and optionally registers with a running backend).
#
#   plugin-smoke-test.sh <velocity|paper> <server-version> <plugin.jar> [backend-url] [registration-token]
#
# The server jar is downloaded from the official PaperMC download API and its
# SHA-256 checksum is verified. For Paper, the Minecraft EULA is accepted for
# this throwaway test server only (eula.txt) – required to start it at all.
# Exit code 0 = plugin enabled without errors (and, with a backend, registered
# and connected). Logs are kept in the work directory for diagnosis.
set -euo pipefail

platform="$1"; mc_version="$2"; jar="$(realpath "$3")"; backend="${4:-}"; token="${5:-}"
work="${SMOKE_WORKDIR:-$(mktemp -d)}/$platform-$mc_version"
timeout_seconds="${SMOKE_TIMEOUT:-300}"
mkdir -p "$work/plugins"
cd "$work"

case "$platform" in
  velocity) data_dir="plugins/networkmanager"; stop_cmd="shutdown" ;;
  paper) data_dir="plugins/NetworkManager"; stop_cmd="stop" ;;
  *) echo "Unknown platform $platform" >&2; exit 2 ;;
esac

echo "[smoke] Downloading $platform $mc_version"
build=$(curl -fsSL -H 'User-Agent: nexora-ci' "https://fill.papermc.io/v3/projects/$platform/versions/$mc_version/builds/latest")
url=$(node -e 'const b=JSON.parse(process.argv[1]);console.log(b.downloads["server:default"].url)' "$build")
sha=$(node -e 'const b=JSON.parse(process.argv[1]);console.log(b.downloads["server:default"].checksums.sha256)' "$build")
build_id=$(node -e 'console.log(JSON.parse(process.argv[1]).id)' "$build")
curl -fsSL -H 'User-Agent: nexora-ci' -o server.jar "$url"
echo "$sha  server.jar" | sha256sum -c -
echo "[smoke] $platform $mc_version build $build_id"

cp "$jar" plugins/
if [ -n "$backend" ]; then
  mkdir -p "$data_dir"
  printf 'backend-url=%s\nregistration-token=%s\n' "$backend" "$token" > "$data_dir/config.properties"
fi
if [ "$platform" = "paper" ]; then
  echo "eula=true" > eula.txt
  printf 'online-mode=false\nserver-port=25566\nlevel-type=minecraft\\:flat\ngenerate-structures=false\nview-distance=2\nsimulation-distance=2\nspawn-protection=0\n' > server.properties
fi

mkfifo console
# Keep the console pipe open for the server's lifetime.
sleep infinity > console &
keeper=$!
java -Xms512M -Xmx1536M -jar server.jar --nogui < console > server.log 2>&1 &
server=$!

cleanup() {
  kill "$keeper" 2>/dev/null || true
  kill "$server" 2>/dev/null || true
}
trap cleanup EXIT

wait_for() {
  local pattern="$1" deadline=$((SECONDS + timeout_seconds))
  until grep -Eq "$pattern" server.log; do
    if ! kill -0 "$server" 2>/dev/null; then echo "[smoke] Server exited early" >&2; return 1; fi
    if [ "$SECONDS" -ge "$deadline" ]; then echo "[smoke] Timeout waiting for: $pattern" >&2; return 1; fi
    sleep 2
  done
}

status=0
wait_for 'Done \(' || status=1
if [ "$status" -eq 0 ] && [ -n "$backend" ]; then
  wait_for 'Registered with the backend as' || status=1
  [ "$status" -eq 0 ] && { wait_for 'Connected to the backend' || status=1; }
fi

# Graceful stop also exercises the plugin's shutdown path.
echo "$stop_cmd" > console
for _ in $(seq 1 60); do kill -0 "$server" 2>/dev/null || break; sleep 1; done

echo "[smoke] ----- server.log (plugin lines) -----"
grep -iE 'networkmanager|network manager|dev\.mnm|exception|error' server.log | head -80 || true

if [ "$platform" = "paper" ]; then
  grep -q 'Enabling NetworkManager' server.log || { echo "[smoke] Plugin was not enabled" >&2; status=1; }
else
  grep -Eqi 'loaded plugin networkmanager|networkmanager.*loaded' server.log || { echo "[smoke] Plugin was not loaded" >&2; status=1; }
fi
# Any stack trace mentioning our packages, or a failed load/enable, fails the test.
if grep -Eq 'dev\.mnm\.[A-Za-z.]+(Exception|Error)|at dev\.mnm\.|Error occurred while enabling NetworkManager|Could not load .*Nexora|NoClassDefFoundError|ClassNotFoundException: (dev\.mnm|com\.google|org\.yaml|net\.kyori)' server.log; then
  echo "[smoke] Plugin errors found in the log" >&2
  status=1
fi
[ "$status" -eq 0 ] && echo "[smoke] ✅ $platform $mc_version: plugin OK" || { echo "[smoke] ❌ $platform $mc_version failed – full log: $work/server.log" >&2; tail -60 server.log >&2; }
exit "$status"
