#!/usr/bin/env node
// Inspects the built plugin jars before they are published.
//
//   node infrastructure/scripts/verify-plugin-jars.mjs <version> [velocity.jar] [paper.jar]
//
// Defaults to apps/velocity-plugin/build/libs/Nexora-Velocity-<version>.jar and
// apps/paper-plugin/build/libs/Nexora-Paper-<version>.jar. Fails (exit 1) when a
// jar is missing or empty, a descriptor or manifest carries the wrong version,
// required classes/resources are missing, classes target the wrong Java
// version, or libraries that the server already provides were bundled.
import { readFileSync, statSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const [version, velocityPath, paperPath] = process.argv.slice(2);
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Usage: verify-plugin-jars.mjs <version> [velocity.jar] [paper.jar]');
  process.exit(2);
}
const JAVA_CLASS_MAJOR = 69; // Java 25

/** Minimal ZIP reader (central directory; stored and deflated entries). */
function readZip(path) {
  const buf = readFileSync(path);
  let end = buf.length - 22;
  while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('not a ZIP/JAR file');
  const count = buf.readUInt16LE(end + 10);
  let offset = buf.readUInt32LE(end + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) throw new Error('corrupt central directory');
    const method = buf.readUInt16LE(offset + 10);
    const compressed = buf.readUInt32LE(offset + 20);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const local = buf.readUInt32LE(offset + 42);
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLength);
    entries.set(name, { method, compressed, local });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return {
    names: [...entries.keys()],
    read(name) {
      const e = entries.get(name);
      if (!e) return null;
      const start = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
      const data = buf.subarray(start, start + e.compressed);
      return e.method === 0 ? data : inflateRawSync(data);
    },
  };
}

let failures = 0;
function check(ok, message) {
  console.log(`  ${ok ? '✔' : '✖'} ${message}`);
  if (!ok) failures++;
  return ok;
}

/** Packages the servers provide at runtime; bundling them causes conflicts. */
const FORBIDDEN = ['com/google/gson/', 'org/yaml/', 'net/kyori/', 'org/slf4j/', 'com/velocitypowered/', 'io/papermc/', 'org/bukkit/', 'org/spigotmc/', 'org/junit/', 'kotlin/'];

function common(zip, label) {
  const manifest = zip.read('META-INF/MANIFEST.MF')?.toString('utf8') ?? '';
  check(/^Implementation-Version: (.+)$/m.exec(manifest)?.[1]?.trim() === version, `${label}: manifest Implementation-Version ${version}`);
  for (const cls of ['dev/mnm/plugin/BackendConnector.class', 'dev/mnm/plugin/RequestSigner.class', 'dev/mnm/plugin/ManagedSettings.class', 'dev/mnm/plugin/punish/PunishmentFeed.class']) {
    check(zip.names.includes(cls), `${label}: bundles shared ${cls}`);
  }
  for (const res of ['config.properties', 'messages/en-US.yml', 'messages/de-DE.yml']) check(zip.names.includes(res), `${label}: contains ${res}`);
  const bundled = zip.names.filter((n) => FORBIDDEN.some((p) => n.startsWith(p)));
  check(bundled.length === 0, `${label}: no server-provided libraries bundled${bundled.length ? ` (found ${bundled.slice(0, 3).join(', ')})` : ''}`);
  const classes = zip.names.filter((n) => n.endsWith('.class'));
  const wrong = classes.filter((n) => zip.read(n).readUInt16BE(6) !== JAVA_CLASS_MAJOR);
  check(classes.length > 20 && wrong.length === 0, `${label}: ${classes.length} classes, all Java 25 bytecode`);
  const config = zip.read('config.properties')?.toString('utf8') ?? '';
  check(/^registration-token=\s*$/m.test(config), `${label}: default config contains no registration token`);
}

function verifyVelocity(path) {
  console.log(`\nVelocity: ${path}`);
  if (!check(statSync(path, { throwIfNoEntry: false })?.size > 0, 'file exists and is not empty')) return;
  const zip = readZip(path);
  const descriptor = JSON.parse(zip.read('velocity-plugin.json')?.toString('utf8') ?? '{}');
  check(descriptor.id === 'networkmanager', `velocity-plugin.json id "networkmanager" (${descriptor.id})`);
  check(descriptor.version === version, `velocity-plugin.json version ${version} (${descriptor.version})`);
  check(descriptor.main === 'dev.mnm.velocity.NetworkManagerVelocity', 'velocity-plugin.json main class');
  check(zip.names.includes('dev/mnm/velocity/NetworkManagerVelocity.class'), 'main class present');
  check(zip.read('dev/mnm/velocity/BuildInfo.class')?.includes(Buffer.from(version)) === true, 'BuildInfo carries the release version');
  common(zip, 'velocity');
}

function verifyPaper(path) {
  console.log(`\nPaper: ${path}`);
  if (!check(statSync(path, { throwIfNoEntry: false })?.size > 0, 'file exists and is not empty')) return;
  const zip = readZip(path);
  const yml = zip.read('plugin.yml')?.toString('utf8') ?? '';
  const field = (key) => new RegExp(`^${key}:\\s*'?([^'\\n]+)'?\\s*$`, 'm').exec(yml)?.[1]?.trim();
  check(field('name') === 'Nexora', `plugin.yml name "Nexora" (${field('name')})`);
  check(field('version') === version, `plugin.yml version ${version} (${field('version')})`);
  check(field('main') === 'dev.mnm.paper.NetworkManagerPaper', 'plugin.yml main class');
  check(Boolean(field('api-version')), `plugin.yml api-version ${field('api-version')}`);
  check(zip.names.includes('dev/mnm/paper/NetworkManagerPaper.class'), 'main class present');
  check(zip.names.includes('dev/mnm/paper/api/AntiCheatApi.class'), 'AntiCheat API present');
  common(zip, 'paper');
}

verifyVelocity(velocityPath ?? `apps/velocity-plugin/build/libs/Nexora-Velocity-${version}.jar`);
verifyPaper(paperPath ?? `apps/paper-plugin/build/libs/Nexora-Paper-${version}.jar`);
console.log(failures === 0 ? '\n✅ Plugin jars verified.' : `\n❌ ${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
