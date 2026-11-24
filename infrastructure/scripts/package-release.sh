#!/usr/bin/env bash
# Assembles the GitHub Release assets for a version (Linux, used by release.yml).
#
#   package-release.sh <version> <velocity.jar> <paper.jar> <output-dir>
#
# Output: the two plugin jars, nexora-plugins-<version>.zip (jars, example
# configs, README), nexora-deploy-<version>.tar.gz (Docker Compose deployment
# without source code) and SHA256SUMS. Archives are built reproducibly
# (sorted entries, fixed timestamps and owners).
set -euo pipefail

version="$1"; velocity="$(realpath "$2")"; paper="$(realpath "$3")"; out="$4"
root="$(cd "$(dirname "$0")/../.." && pwd)"
epoch="${SOURCE_DATE_EPOCH:-$(git -C "$root" log -1 --format=%ct)}"
compat="$root/infrastructure/compatibility.json"
json() { node -e "const c=require(process.argv[1]);const v=process.argv[2].split('.').reduce((o,k)=>o[k],c);console.log(Array.isArray(v)?v.join(', '):v)" "$compat" "$1"; }
fill() { sed -e "s/{{VERSION}}/$version/g" -e "s/{{JAVA}}/$(json java)/g" -e "s/{{VELOCITY}}/$(json velocity)/g" -e "s/{{PAPER}}/$(json paper)/g" "$1"; }

mkdir -p "$out"
out="$(realpath "$out")"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

cp "$velocity" "$out/Nexora-Velocity-$version.jar"
cp "$paper" "$out/Nexora-Paper-$version.jar"

# Plugins package
p="$work/nexora-plugins-$version"
mkdir -p "$p/examples/velocity" "$p/examples/paper"
cp "$out/Nexora-Velocity-$version.jar" "$out/Nexora-Paper-$version.jar" "$p/"
cp "$root/apps/plugin-common/src/main/resources/config.properties" "$p/examples/velocity/config.properties"
cp "$root/apps/plugin-common/src/main/resources/config.properties" "$p/examples/paper/config.properties"
fill "$root/infrastructure/release/plugins-README.md" > "$p/README.md"
find "$p" -exec touch -d "@$epoch" {} +
(cd "$work" && find "nexora-plugins-$version" -print | LC_ALL=C sort | zip -q -X -D "$out/nexora-plugins-$version.zip" -@)

# Deployment package (no source code; images come from GHCR)
d="$work/nexora"
mkdir -p "$d/infrastructure/scripts" "$d/infrastructure/docker" "$d/geoip"
cp "$root/docker-compose.yml" "$root/.env.example" "$root/LICENSE" "$d/"
cp "$root/infrastructure/docker/Caddyfile" "$d/infrastructure/docker/"
cp "$root/infrastructure/scripts/generate-secrets.sh" "$root/infrastructure/scripts/backup.sh" "$root/infrastructure/scripts/restore.sh" \
  "$root/infrastructure/scripts/repair-db-credentials.sh" "$root/infrastructure/scripts/mysql-credentials.sh" "$d/infrastructure/scripts/"
fill "$root/infrastructure/release/deploy-README.md" > "$d/README.md"
echo "Optional MaxMind GeoLite2 databases (see the player profiles documentation)." > "$d/geoip/README.txt"
tar --sort=name --mtime="@$epoch" --owner=0 --group=0 --numeric-owner -C "$work" -cf - nexora | gzip -n -9 > "$out/nexora-deploy-$version.tar.gz"

(cd "$out" && sha256sum "Nexora-Velocity-$version.jar" "Nexora-Paper-$version.jar" "nexora-plugins-$version.zip" "nexora-deploy-$version.tar.gz" > SHA256SUMS)
echo "Release assets in $out:"
ls -l "$out"
cat "$out/SHA256SUMS"
