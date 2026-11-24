# Changelog

All notable changes are documented here. The project follows [Semantic Versioning](https://semver.org/) and [Conventional Commits](https://www.conventionalcommits.org/).

## [1.0.0] – 2026-11-24

First stable release (Phase 9 – production readiness).

### Added
- Optional TOTP two-factor authentication for dashboard accounts: authenticator-app enrolment with QR code, encrypted secrets, replay protection, single-use recovery codes, two-step login and administrator reset.
- `infrastructure/scripts/backup.sh` and `restore.sh` (verified backups with retention; restore with database recreation).
- `infrastructure/scripts/verify-deployment.mjs`: end-to-end verification of a running installation (setup, registration, signed plugin traffic, 2000 seeded players), load test with latency thresholds and post-restore checks.
- CI job *Deployment*: builds and starts the Docker Compose stack, verifies it, load-tests it, restarts it, backs it up, deletes all volumes, restores and verifies the data.
- Route permission audit test and the generated [permission matrix](docs/architecture/permission-matrix.md).
- Documentation: security review, production deployment guide, test layers, `SECURITY.md`.

### Security
- Content-Security-Policy and Cross-Origin-Opener-Policy for the dashboard.
- Backend and dashboard containers drop all Linux capabilities and set `no-new-privileges`.
- `effect` (Prisma CLI dependency) pinned to 3.22.5 (GHSA-7589-6fvf-x4pw); the dependency audit now fails on high-severity findings.
- RBAC e2e tests cover all write endpoints added after Phase 3.

### Known limitations
- Plugin messages use one language per network (with per-language overrides); per-player languages based on the Minecraft client locale are not implemented yet.

## [0.8.0] – 2026-11-23 – Configuration and setup
- Guided server registration with Velocity/Paper configuration generator, ZIP package and live registration status.
- Centrally managed plugin settings (language, messages, statistics, inventories) applied live via configuration revisions.
- Punishment templates, language management with catalogue import/export and runtime-added languages.
- Plugin options `managed-settings`, `punishments-enabled`, `moderation-commands`.

## [0.7.0] – 2026-11-23 – Inventory management
- Inventory and Ender Chest viewer/editor per server with per-slot compare-and-set, offline queue, history and rollback.

## [0.6.0] – 2026-11-23 – AntiCheat integration
- Java API for allow-listed AntiCheat plugins, `/anticheatban`, rule engine with safe defaults, event history.

## [0.5.0] – 2026-11-23 – Statistics
- Minecraft statistics collection on Paper, hourly history, ranges, charts, leaderboards.

## [0.4.0] – 2026-11-23 – Player profiles
- Player search, profiles with 3D skins, activity heatmaps, connection history, GeoIP, IP retention.

## [0.3.0] – 2026-11-23 – Punishments
- Network-wide bans, mutes, kicks, warnings, IP blacklists; moderation commands; offline-capable plugin caches.

## [0.2.0] – Minecraft integration
- Velocity and Paper plugins, signed plugin API, sessions, heartbeats, realtime updates.

## [0.1.0] – Foundation
- Monorepo, Docker Compose, backend, dashboard, authentication, RBAC, i18n, setup wizard, CI.

[1.0.0]: https://github.com/epicclowds/Nexora/releases/tag/v1.0.0
