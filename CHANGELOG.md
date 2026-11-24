# Changelog

All notable changes are documented here. The project follows [Semantic Versioning](https://semver.org/) and [Conventional Commits](https://www.conventionalcommits.org/).

## [1.0.3] – 2026-11-24

Fixes database authentication failures (`Prisma P1000`) in Docker deployments.

### Fixed
- Backend could not connect when the passwords in `.env` differed from the ones MySQL stored in its data volume at first start (e.g. after extracting a release package into a new folder and running `generate-secrets.sh` there). The backend now stops immediately with an explanation and recovery steps instead of retrying silently ten times.
- Database and Redis passwords with special characters (`@ : / # % ? &` …) broke the connection URLs. Compose now passes the credentials separately and the backend builds percent-encoded URLs; nothing secret is logged.

### Added
- `infrastructure/scripts/repair-db-credentials.sh`: makes the MySQL accounts match `.env` without data loss – online via the root account, or (if the root password changed too) after a full backup in a short maintenance mode.
- `generate-secrets.sh` refuses to create new passwords when a Nexora database volume already exists.
- CI and the release pipeline test special-character passwords, both password-drift cases with diagnosis and repair (also on the published images), and that no password appears in the container logs.

### Migration from 1.0.2
Keep your `.env`. Take `docker-compose.yml` and `infrastructure/scripts/` from the 1.0.3 deployment package, set `NEXORA_VERSION=1.0.3`, then `docker compose pull && docker compose up -d`. If the backend reports P1000, see [Database password mismatch](docs/installation/README.md#database-password-mismatch-p1000).

## [1.0.2] – 2026-11-24

Distribution release: Nexora can now be installed entirely from prebuilt artifacts.

> Version 1.0.1 was tagged but never released: the release pipeline stopped at the verification of the published images (see *Fixed*), so no GitHub Release was created and `latest` was not moved. Its `1.0.1` images remain in the registry but are superseded; use 1.0.2.

### Added
- GitHub Releases with `Nexora-Velocity-1.0.2.jar`, `Nexora-Paper-1.0.2.jar`, a plugin package with example configurations, a Docker deployment package (`nexora-deploy-1.0.2.tar.gz`, no source code needed) and `SHA256SUMS`.
- Release pipeline: version consistency check, full CI, plugin smoke tests on real Velocity/Paper servers, multi-arch images (`linux/amd64`, `linux/arm64`) with provenance and SBOM, vulnerability scan, clean installation from the published images with real plugin servers, verified asset downloads, `latest` only after all checks.
- *Build plugins* workflow: tests, jar inspection (descriptors, versions, bytecode level, no bundled server libraries), startup smoke tests on Velocity 4.3.1 and Paper 26.1.2, 26.2 and 26.3, downloadable artifacts for every build.
- Dashboard warning for servers whose plugin belongs to another release (*Update recommended* / *Update required*).
- `docker-compose.dev.yml` for building the images from source.

### Fixed
- Plugins could not register with a dashboard reached over plain `http://` (e.g. a private network address): Java's HTTP client tried an HTTP/2 (`h2c`) upgrade, which the dashboard server closes without a response. The plugins now use HTTP/1.1. Found by the new integration test with real Velocity/Paper servers.
- Release pipeline: the plugin artifact is uploaded as a flat folder, so the verification and release jobs find the jars (this stopped the 1.0.1 release before the GitHub Release was created).

### Changed
- **Breaking (deployment):** `docker-compose.yml` now pulls `ghcr.io/epicclowds/nexora/{backend,dashboard}:${NEXORA_VERSION}` instead of building locally. `.env` uses `NEXORA_VERSION`/`NEXORA_IMAGE_PREFIX` instead of `MNM_VERSION`/`MNM_IMAGE_PREFIX`.
- Plugin files are named `Nexora-Velocity-<version>.jar` and `Nexora-Paper-<version>.jar`; jars carry `Implementation-Version` and are built reproducibly. Plugin ids and data folders are unchanged.
- Installation, plugin and update guides rewritten for the release-based installation.
- GitHub Actions updated to current major versions (Node.js 24 runtime).

### Migration from 1.0.0
Replace `docker-compose.yml` with the one from the release, add `NEXORA_VERSION=1.0.2` to `.env` and remove the `MNM_*` lines, then `docker compose pull && docker compose up -d`. Replace the plugin jars (delete the old `NetworkManager-*.jar`). Data and plugin configurations are kept. See [Updating](docs/installation/updating.md#upgrading-from-100).

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

[1.0.3]: https://github.com/epicclowds/Nexora/releases/tag/v1.0.3
[1.0.2]: https://github.com/epicclowds/Nexora/releases/tag/v1.0.2
[1.0.0]: https://github.com/epicclowds/Nexora/releases/tag/v1.0.0
