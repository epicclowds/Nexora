# Nexora

**Nexora – Minecraft Network Manager** is a self-hosted administration and player-intelligence platform for Minecraft networks running **Velocity** (proxy) and **Paper** (backend servers): network-wide punishments, player profiles and statistics, AntiCheat integration, inventory management, server monitoring, update notifications and a multilingual web dashboard. It runs with Docker Compose from prebuilt images – nothing is compiled on your server.

> **Status: v1.3.0 – stable.** Backend and dashboard are published as Docker images on GitHub Container Registry, the Minecraft plugins as jars on the [Releases page](https://github.com/epicclowds/Nexora/releases). See the [changelog](CHANGELOG.md).

## Features

| Area | What works today |
| --- | --- |
| Deployment | Docker Compose stack (MySQL 8.4, Redis 7.4, backend, dashboard), healthchecks, automatic migrations, optional HTTPS via Caddy |
| Setup wizard | Service checks, migration status, Owner creation protected by a one-time setup code, network configuration, Velocity registration token |
| Authentication | Argon2id passwords, optional TOTP two-factor authentication with recovery codes, short-lived access tokens + rotating refresh tokens in `HttpOnly`/`SameSite=Strict` cookies, CSRF header check, per-IP rate limits (Redis) and per-account lockout |
| Authorization | Role-based access control with six default roles, custom roles, wildcard permissions, privilege-escalation prevention, enforced server-side |
| Audit log | Every administrative action is recorded and searchable |
| Internationalization | `en-US` default, `de-DE` bundled, per-user language with instant switching, ICU plurals, locale-aware numbers/dates, time-zone aware timestamps, catalogue validation (no HTML/script injection) |
| Minecraft plugins | Velocity 4 and Paper 26 plugins (Java 25): token registration, HMAC-signed requests with replay protection, ordered event buffering during outages, periodic sync, heartbeats (TPS, MSPT, memory, CPU), `/networkmanager` status command |
| Players | Search by name, previous name or UUID; live online list; profiles with tabs (Overview, Moderation, Connections, Activity, Notes); 3D skin preview and heads served without third-party requests from the browser; daily playtime chart and weekday/hour heatmap; connection history with IP summary and alternate-account hints (`players.view.ip`); optional approximate GeoLite2 location (`players.view.location`); configurable IP retention |
| Servers | Registration tokens, live status, credential rotation/revocation, enable/disable, rename, delete; crashed proxies detected and their sessions closed |
| Statistics | Movement, combat, blocks (per type, ores) and general statistics from Minecraft's own counters plus active/AFK time, chat messages and XP; tick-spread collection; hourly history with 24 h / 7 d / 30 d / custom ranges (partial coverage flagged, resets handled); daily charts; network totals and leaderboards |
| AntiCheat | Java API for allow-listed AntiCheat plugins and console-only `/anticheatban`; dashboard rule engine per check (action, duration, VL threshold, cooldown), safe defaults (log only), rate limits, idempotent reports, evidence on punishments, event history and daily counters |
| Inventories | View and edit inventories and Ender Chests per server in a Minecraft-style editor (drag & drop, amount, name, lore, enchantments); per-slot compare-and-set applied atomically on the server thread (no duplication or loss), offline edits queued until the next join, revision history with rollback, full audit trail |
| Configuration | Setup wizard; guided server registration with Velocity/Paper config generator (copy, download, ZIP package with instructions, live registration status); plugin settings and in-game messages managed centrally and applied live without restarts; punishment templates; language management with catalogue import/export and runtime-added languages |
| Updates | Central, read-only check of GitHub Releases (cached, ETag, rate-limit aware, every 6 h by default); dashboard notification and **Settings → Updates** with backend, dashboard and per-server plugin versions, compatibility warnings and release notes; in-game notifications for staff and `/nexora update`; never installs anything by itself |
| Staff & LuckPerms | Optional LuckPerms integration on the proxy (groups, ranks, permissions with inheritance and denials, event-driven sync plus reconciliation); `/nexora link` account linking with one-time codes; group → role mapping; LuckPerms-managed staff accounts that lose access (and sessions) when their rank is removed; protected Owner; staff permission matrix |
| Realtime | Server-Sent Events with Redis fan-out; permission-filtered |
| Moderation | Bans, temp bans, IP blacklists, mutes, temp mutes, kicks, warnings; `/ban /tempban /unban /mute /tempmute /unmute /kick /warn /history /check /editban /editmute`; numbered reason presets (`/ban Steve 1`) with per-reason permissions and a network-wide command mode (reason IDs / typed reasons / hybrid); editing of reason, duration and permanent/temporary with preview, optimistic locking and live sync; multiple evidence entries per punishment (video, screenshot, link, text, note) that can be added later; immutable change history; login checks from a local, disk-persisted cache (no network on join, works during outages); mutes enforced on Paper; duplicate prevention and idempotency; dashboard moderation page, player history, revoke, internal notes; full audit trail |
| Dashboard | Live overview, players, online players, player profiles, servers, users & roles, audit log, settings; dark/light theme; responsive |
| API | REST with OpenAPI docs at `/api/docs`; [permission matrix](docs/architecture/permission-matrix.md) generated from the code |
| Operations | Verified backup/restore scripts, deployment verification and load test (run in CI against the real Compose stack), hardened containers, Content-Security-Policy |

## Requirements

- A Linux server, 64-bit `amd64` (`x86_64`) or `arm64`, with 2 GB RAM (4 GB for large networks) and 10 GB free disk space
- [Docker Engine](https://docs.docker.com/engine/install/) 24 or newer with the Docker Compose plugin (`docker compose version` must work)
- `curl` and `openssl` (preinstalled on most distributions)
- Port `3000` (or 80/443 with HTTPS) reachable by your staff **and** your Minecraft servers
- Velocity 4.3 proxy and Paper 26 servers with Java 25 for the plugins

## Quick start

These steps install Nexora on a Linux server from the command line. They use only the standalone [`docker-compose.yml`](https://github.com/epicclowds/Nexora/blob/main/docker-compose.yml) – no repository checkout, archive or build.

**1. Install Docker** (skip if `docker compose version` already works):

```sh
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"   # log out and in again afterwards
```

**2. Download `docker-compose.yml`:**

```sh
mkdir nexora
cd nexora
curl -fsSL https://raw.githubusercontent.com/epicclowds/Nexora/main/docker-compose.yml -o docker-compose.yml
```

**3. Configure the environment variables.** Nexora needs four secrets in a file called `.env` next to `docker-compose.yml`. Generate random values:

```sh
cat > .env <<EOF
MYSQL_PASSWORD=$(openssl rand -hex 24)
MYSQL_ROOT_PASSWORD=$(openssl rand -hex 24)
REDIS_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 48)
EOF
chmod 600 .env
```

Or write the file yourself with `nano .env`:

```dotenv
MYSQL_PASSWORD=replace-with-a-long-random-value
MYSQL_ROOT_PASSWORD=replace-with-another-long-random-value
REDIS_PASSWORD=replace-with-a-third-long-random-value
JWT_SECRET=replace-with-at-least-32-random-characters
```

> **Keep these values and back up `.env`.** MySQL stores its passwords when it starts for the first time; the same values must be used for every later start and update. Never generate a new `.env` for an existing installation. Optional settings (port, version pinning, HTTPS, …): [Environment variables](docs/installation/environment.md).

**4. Start Nexora:**

```sh
docker compose pull
docker compose up -d
```

Check that all four services (`mysql`, `redis`, `backend`, `dashboard`) become `healthy` – this takes one to two minutes:

```sh
docker compose ps
```

View the logs (press `Ctrl+C` to stop following them):

```sh
docker compose logs -f
```

**5. Open the dashboard** in a browser:

```
http://YOUR_SERVER_IP:3000
```

(`3000` is the default; change it with `DASHBOARD_PORT` in `.env`. For a domain with HTTPS see [HTTPS and reverse proxies](docs/installation/https.md).)

**6. Complete the setup wizard.** It asks for a one-time setup code, which the backend prints to its log:

```sh
docker compose logs backend | grep "Setup code"
```

Create the Owner account, name your network and choose the language (English is preselected). Details: [Installation guide](docs/installation/README.md).

## Minecraft plugin installation

1. Download `Nexora-Velocity-<version>.jar` and `Nexora-Paper-<version>.jar` from the [latest release](https://github.com/epicclowds/Nexora/releases/latest).
2. In the dashboard open **Settings → Minecraft integration → Add a server**. It generates a ready-to-use `config.properties` with a one-time registration token for each server.
3. Put the jar into the server's `plugins/` folder, the generated `config.properties` into the plugin folder, and start the server. The server appears in the dashboard within seconds.

Step-by-step guide, permissions and commands: [Minecraft plugins](docs/installation/minecraft-plugins.md).

## Updating Nexora

Nexora tells you about new releases: in the dashboard (**Settings → Updates** and a notification for administrators) and in-game for staff with `networkmanager.update.notify`. It never updates itself.

1. **Back up** the database ([Backup & restore](docs/installation/backup-restore.md)).
2. **Pull the updated images:** `docker compose pull`
3. **Recreate the updated containers:** `docker compose up -d` – database migrations run automatically.
4. **Verify** that all services are healthy again: `docker compose ps`

```sh
docker compose pull
docker compose up -d
docker compose ps
```

By default the stack uses the `latest` image tag, which moves to each new stable release once it has passed all release checks. If you pinned a version (`NEXORA_VERSION=1.1.0` in `.env`), change that value to the new version first. Then update the Minecraft plugins to the same release. Your data stays in the Docker volumes – never use `docker compose down -v` (it deletes the database). More: [Updating](docs/installation/updating.md).

## Alternative installation methods

The same standalone `docker-compose.yml` also works in Docker management interfaces – paste it as a stack and enter the four secrets as environment variables:

- [Portainer](docs/installation/portainer.md)
- [Arcane](docs/installation/arcane.md)

Moving an existing installation between methods keeps its data: [Moving an existing installation](docs/installation/migration.md). Each release also offers `nexora-deploy-<version>.tar.gz` (the same file plus optional helper scripts).

## Documentation

- **Installation:** [Installation guide](docs/installation/README.md) · [Environment variables](docs/installation/environment.md) · [Minecraft plugins](docs/installation/minecraft-plugins.md) · [Updating](docs/installation/updating.md) · [Backup & restore](docs/installation/backup-restore.md) · [HTTPS](docs/installation/https.md) · [Production checklist](docs/installation/deployment.md) · [Portainer](docs/installation/portainer.md) · [Arcane](docs/installation/arcane.md) · [Moving an installation](docs/installation/migration.md)
- **Architecture:** [Overview](docs/architecture/overview.md) · [Database decision](docs/architecture/database.md) · [Security model](docs/architecture/security.md) · [Internationalization](docs/architecture/i18n.md) · [Plugin protocol](docs/architecture/plugin-protocol.md) · [Realtime](docs/architecture/realtime.md) · [Punishments](docs/architecture/punishments.md) · [Player profiles](docs/architecture/player-profiles.md) · [Statistics](docs/architecture/statistics.md) · [AntiCheat](docs/architecture/anticheat.md) · [Inventories](docs/architecture/inventory.md) · [Configuration](docs/architecture/configuration.md) · [Updates](docs/architecture/updates.md) · [LuckPerms & staff accounts](docs/architecture/luckperms.md) · [Security review](docs/architecture/security-review.md) · [Permission matrix](docs/architecture/permission-matrix.md)
- **Reference:** [API](docs/api/README.md) · [Development](docs/development/README.md)

| Release artifact | Where |
| --- | --- |
| Backend image | `ghcr.io/epicclowds/nexora/backend:latest` or `:<version>` (`linux/amd64`, `linux/arm64`) |
| Dashboard image | `ghcr.io/epicclowds/nexora/dashboard:latest` or `:<version>` (`linux/amd64`, `linux/arm64`) |
| Velocity plugin | `Nexora-Velocity-<version>.jar` (Velocity 4.3.1, Java 25) |
| Paper plugin | `Nexora-Paper-<version>.jar` (Paper 26.1.2–26.3, Java 25) |
| Deployment | `docker-compose.yml` (standalone); optional package with helper scripts: `nexora-deploy-<version>.tar.gz` |

## Repository layout

```
apps/
  backend/          NestJS API, Prisma schema & migrations
  dashboard/        Next.js dashboard (App Router, Tailwind, next-intl)
  plugin-common/    Shared Java code: backend client, signing, event queue, messages
  velocity-plugin/  Velocity 4 proxy plugin
  paper-plugin/     Paper 26 server plugin
packages/
  shared-types/     Permissions, roles, locales and shared contracts
  translations/     Dashboard catalogues (JSON) + plugin messages (YAML) + validator
infrastructure/
  docker/           Dockerfiles, backend entrypoint
  scripts/          Operational scripts
docs/               Architecture, installation, API and development docs
```

## Roadmap

| Version | Milestone | Status |
| --- | --- | --- |
| v0.1.0 | Foundation: monorepo, Docker, backend, dashboard, auth, RBAC, i18n, setup wizard, CI | ✅ implemented |
| v0.2.0 | Minecraft integration: Velocity & Paper plugins, signed plugin API, sessions, heartbeats, live updates | ✅ implemented |
| v0.3.0 | Network-wide punishment system and moderation commands | ✅ implemented |
| v0.4.0 | Player search & profiles | ✅ implemented |
| v0.5.0 | Statistics collection and charts | ✅ implemented |
| v0.6.0 | AntiCheat integration | ✅ implemented |
| v0.7.0 | Inventory management | ✅ implemented |
| v0.8.0 | Configuration and setup | ✅ implemented |
| v1.0.0 | Production readiness: security review, 2FA, permission audit, deployment/load/backup verification | ✅ released |
| v1.0.2 | Distribution: GitHub Releases with plugin jars, prebuilt GHCR images by default, release pipeline | ✅ released |
| v1.0.3 | Database credentials: encoded connection URLs, P1000 diagnosis, non-destructive repair script | ✅ released |
| v1.1.0 | Punishment editing (`/editban`, `/editmute`, dashboard), evidence management, change history, appeal link | ✅ released |
| v1.2.0 | Update notifications (dashboard, in-game, `/nexora update`), standalone Docker Compose for CLI, Portainer and Arcane | ✅ released |
| v1.2.1 | Update checker: rate-limit recovery at reset time, Redis cache and lock, optional GITHUB_TOKEN, clear verification status | ✅ released |
| v1.3.0 | Punishment reason presets and command modes, optional LuckPerms integration, account linking, managed staff accounts, Nexora branding, System theme and refreshed design | ✅ released |

## Contributing

Issues and pull requests are welcome. The [development guide](docs/development/README.md) explains the local setup, tests and conventions (Conventional Commits; CI must pass). Please report security problems privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
