#!/usr/bin/env node
// Ensures every component carries the same release version.
//
//   node infrastructure/scripts/check-versions.mjs [expected-version]
//
// Checks package.json files (root, backend, dashboard, shared packages and
// their internal dependency ranges), gradle.properties (both plugins),
// and the CHANGELOG. The default image tag in docker-compose.yml and
// NEXORA_VERSION in .env.example must be "latest". With an expected version (e.g. from a release tag) all of
// them must match it. Prints the version on success.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const expected = process.argv[2]?.replace(/^v/, '');

const found = [];
for (const path of ['package.json', 'apps/backend/package.json', 'apps/dashboard/package.json', 'packages/shared-types/package.json', 'packages/translations/package.json']) {
  const pkg = JSON.parse(read(path));
  found.push([path, pkg.version]);
  for (const dep of ['@mnm/shared-types', '@mnm/translations']) {
    if (pkg.dependencies?.[dep]) found.push([`${path} → ${dep}`, pkg.dependencies[dep]]);
  }
}
found.push(['gradle.properties pluginVersion (Velocity + Paper)', /^pluginVersion=(.+)$/m.exec(read('gradle.properties'))?.[1]?.trim()]);
const compose = read('docker-compose.yml');
// Stable mode: the standalone stack follows "latest", which is only promoted
// after a verified release (promote-latest.yml). Pinning is done by the user.
const defaults = [];
for (const component of ['backend', 'dashboard']) {
  defaults.push([`docker-compose.yml ${component} default tag`, new RegExp(`/${component}:\\$\\{NEXORA_VERSION:-([^}]+)\\}`).exec(compose)?.[1]]);
}
defaults.push(['.env.example NEXORA_VERSION', /^NEXORA_VERSION=(.+)$/m.exec(read('.env.example'))?.[1]?.trim()]);
found.push(['CHANGELOG.md latest entry', /^## \[(\d+\.\d+\.\d+[^\]]*)\]/m.exec(read('CHANGELOG.md'))?.[1]]);

const version = expected ?? found[0][1];
const mismatches = found.filter(([, v]) => v !== version);
for (const [where, v] of found) console.error(`${v === version ? '✔' : '✖'} ${where}: ${v ?? '(missing)'}`);
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version ?? '')) {
  console.error(`✖ "${version}" is not a semantic version`);
  process.exit(1);
}
const wrongDefaults = defaults.filter(([, v]) => v !== 'latest');
for (const [where, v] of defaults) console.error(`${v === 'latest' ? '✔' : '✖'} ${where}: ${v ?? '(missing)'} (expected latest)`);
if (wrongDefaults.length) {
  console.error(`\n✖ ${wrongDefaults.length} default image tag(s) are not "latest".`);
  process.exit(1);
}
if (mismatches.length) {
  console.error(`\n✖ ${mismatches.length} component(s) do not match version ${version}.`);
  process.exit(1);
}
console.log(version);
