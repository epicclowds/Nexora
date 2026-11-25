#!/usr/bin/env node
// Builds the GitHub Release notes for a version.
//
//   node infrastructure/scripts/release-notes.mjs <version> [SHA256SUMS] > notes.md
//
// Content: the CHANGELOG entry of the version (features, fixes, security,
// breaking changes, migration notes), tested compatibility from
// infrastructure/compatibility.json, Docker image tags with digests
// (BACKEND_DIGEST / DASHBOARD_DIGEST environment variables), installation and
// update instructions, and the SHA-256 checksums of all assets.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..');
const version = process.argv[2]?.replace(/^v/, '');
const sumsFile = process.argv[3];
if (!version) {
  console.error('Usage: release-notes.mjs <version> [SHA256SUMS]');
  process.exit(2);
}
const repo = process.env.GITHUB_REPOSITORY ?? 'epicclowds/Nexora';
const image = `ghcr.io/${repo.toLowerCase()}`;
const compat = JSON.parse(readFileSync(join(root, 'infrastructure', 'compatibility.json'), 'utf8'));

const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
const start = changelog.search(new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`, 'm'));
if (start < 0) {
  console.error(`CHANGELOG.md has no entry for ${version}`);
  process.exit(1);
}
const rest = changelog.slice(start);
const next = rest.slice(1).search(/^## \[/m);
const entry = (next < 0 ? rest : rest.slice(0, next + 1))
  .split('\n')
  .slice(1)
  .join('\n')
  .replace(/^### /gm, '## ')
  .trim();

const digest = (name) => process.env[`${name}_DIGEST`] ? `@${process.env[`${name}_DIGEST`]}` : '';
const sums = sumsFile ? readFileSync(sumsFile, 'utf8').trim() : '';

const notes = `${entry}

## Downloads

| File | For |
| --- | --- |
| \`Nexora-Velocity-${version}.jar\` | Velocity proxy → \`plugins/\` |
| \`Nexora-Paper-${version}.jar\` | Every Paper server → \`plugins/\` |
| \`nexora-plugins-${version}.zip\` | Both plugins, example configurations and instructions |
| \`nexora-deploy-${version}.tar.gz\` | Optional: the same \`docker-compose.yml\` with helper scripts (backup, restore, credential repair) |
| \`SHA256SUMS\` | Checksums of all files above |

## Compatibility (tested in CI)

| Component | Versions |
| --- | --- |
| Velocity | ${compat.velocity.join(', ')} |
| Paper (Minecraft) | ${compat.paper.join(', ')} |
| Java (Minecraft servers) | ${compat.java} or newer |
| Docker host | Docker Engine 24+ with Compose v2, \`linux/amd64\` or \`linux/arm64\` |

Use plugins and server images of the **same version**: the dashboard warns about plugins with a different version.

## Docker images

| Image | Tags | Digest |
| --- | --- | --- |
| \`${image}/backend\` | \`${version}\`, \`v${version}\` | \`${process.env.BACKEND_DIGEST ?? 'see package page'}\` |
| \`${image}/dashboard\` | \`${version}\`, \`v${version}\` | \`${process.env.DASHBOARD_DIGEST ?? 'see package page'}\` |

\`latest\` points to the newest stable release once all release checks passed. Pin by digest for fully reproducible deployments, e.g. \`${image}/backend${digest('BACKEND') || `:${version}`}\`.

## Install

Paste [\`docker-compose.yml\`](https://github.com/${repo}/blob/v${version}/docker-compose.yml) into Portainer, Arcane or a folder on the server, set \`MYSQL_PASSWORD\`, \`MYSQL_ROOT_PASSWORD\`, \`REDIS_PASSWORD\` and \`JWT_SECRET\`, and deploy (\`docker compose pull && docker compose up -d\`). No other files are needed. Then open \`http://<server>:3000\` and follow the [installation guide](https://github.com/${repo}/blob/v${version}/docs/installation/README.md) and the [Minecraft plugin guide](https://github.com/${repo}/blob/v${version}/docs/installation/minecraft-plugins.md). \`nexora-deploy-${version}.tar.gz\` contains the same file plus optional helper scripts.

## Update an existing installation

1. Back up the database ([Backup & restore](https://github.com/${repo}/blob/v${version}/docs/installation/backup-restore.md)).
2. \`docker compose pull && docker compose up -d\` (with \`NEXORA_VERSION=latest\`), or set \`NEXORA_VERSION=${version}\` first when pinned; in Portainer/Arcane re-pull and redeploy. Database migrations run automatically.
3. Replace both plugin jars with the files from this release and restart the servers.

Details: [Updating](https://github.com/${repo}/blob/v${version}/docs/installation/updating.md).
${sums ? `\n## Checksums (SHA-256)\n\n\`\`\`\n${sums}\n\`\`\`\n` : ''}`;
process.stdout.write(notes);
