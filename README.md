# Minecraft Network Manager

A self-hosted administration and player-intelligence platform for Minecraft networks running **Velocity** (proxy) and **Paper** (backend servers): network-wide punishments, player profiles and statistics, AntiCheat integration, inventory management, server monitoring and a multilingual web dashboard. Everything is deployed with Docker Compose.

> **Status: v0.3.0 – Phase 3 (Punishment system).** The web platform, the Velocity and Paper plugins and network-wide moderation are implemented: bans, temporary bans, mutes, kicks, warnings and blacklists from in-game commands or the dashboard, enforced on every server. Statistics, AntiCheat and inventory modules are scheduled for the next phases – see [Roadmap](#roadmap). Modules that do not exist yet are shown as "Not available yet" in the dashboard and never display placeholder data.

## Features in this release

| Area | What works today |
| --- | --- |
| Deployment | Docker Compose stack (MySQL 8.4, Redis 7.4, backend, dashboard), healthchecks, automatic migrations, optional HTTPS via Caddy |
| Setup wizard | Service checks, migration status, Owner creation protected by a one-time setup code, network configuration, Velocity registration token |
| Authentication | Argon2id passwords, short-lived access tokens + rotating refresh tokens in `HttpOnly`/`SameSite=Strict` cookies, CSRF header check, per-IP rate limits (Redis) and per-account lockout |
| Authorization | Role-based access control with six default roles, custom roles, wildcard permissions, privilege-escalation prevention, enforced server-side |
| Audit log | Every administrative action is recorded and searchable |
| Internationalization | `en-US` default, `de-DE` bundled, per-user language with instant switching, ICU plurals, locale-aware numbers/dates, time-zone aware timestamps, catalogue validation (no HTML/script injection) |
| Minecraft plugins | Velocity 4 and Paper 26 plugins (Java 25): token registration, HMAC-signed requests with replay protection, ordered event buffering during outages, periodic sync, heartbeats (TPS, MSPT, memory, CPU), `/networkmanager` status command |
| Players | Network sessions, server switches, playtime, name history, client version/brand, connections (IP restricted to `players.view.ip`), search by name/previous name/UUID, online list, profile page |
| Servers | Registration tokens, live status, credential rotation/revocation, enable/disable, rename, delete; crashed proxies detected and their sessions closed |
| Realtime | Server-Sent Events with Redis fan-out; permission-filtered |
| Moderation | Bans, temp bans, IP blacklists, mutes, temp mutes, kicks, warnings; `/ban /tempban /unban /mute /tempmute /unmute /kick /warn /history /check`; login checks from a local, disk-persisted cache (no network on join, works during outages); mutes enforced on Paper; duplicate prevention and idempotency; dashboard moderation page, player history, revoke, internal notes; full audit trail |
| Dashboard | Live overview, players, online players, player profiles, servers, users & roles, audit log, settings; dark/light theme; responsive |
| API | REST with OpenAPI docs at `/api/docs` |

## Quick start

Requirements: Docker Engine 24+ with the Compose plugin. Nothing else needs to be installed on the host.

```sh
git clone <repository-url> minecraft-network-manager
cd minecraft-network-manager
sh infrastructure/scripts/generate-secrets.sh   # creates .env with random secrets
docker compose up -d --build
docker compose logs backend | grep "Setup code"   # one-time code for the wizard
```

Open `http://<host>:3000` and complete the setup wizard. Full guide: [docs/installation](docs/installation/README.md).

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
  docker/           Dockerfiles, entrypoint, Caddyfile
  scripts/          Operational scripts
docs/               Architecture, installation, API and development docs
```

## Documentation

- [Architecture overview](docs/architecture/overview.md) · [Database decision](docs/architecture/database.md) · [Security model](docs/architecture/security.md) · [Internationalization](docs/architecture/i18n.md) · [Plugin protocol](docs/architecture/plugin-protocol.md) · [Realtime](docs/architecture/realtime.md) · [Punishments](docs/architecture/punishments.md)
- [Installation](docs/installation/README.md) · [Minecraft plugins](docs/installation/minecraft-plugins.md) · [Updating](docs/installation/updating.md) · [Backup & restore](docs/installation/backup-restore.md) · [HTTPS](docs/installation/https.md)
- [API](docs/api/README.md) · [Development](docs/development/README.md)

## Roadmap

| Version | Milestone | Status |
| --- | --- | --- |
| v0.1.0 | Foundation: monorepo, Docker, backend, dashboard, auth, RBAC, i18n, setup wizard, CI | ✅ implemented |
| v0.2.0 | Minecraft integration: Velocity & Paper plugins, signed plugin API, sessions, heartbeats, live updates | ✅ implemented |
| v0.3.0 | Network-wide punishment system and moderation commands | ✅ implemented |
| v0.4.0 | Player search & profiles | planned |
| v0.5.0 | Statistics collection and charts | planned |
| v0.6.0 | AntiCheat integration and inventory management | planned |
| v1.0.0 | Production readiness | planned |

## License

[MIT](LICENSE)
