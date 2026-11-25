# Changelog

All notable changes are documented here. The project follows [Semantic Versioning](https://semver.org/) and [Conventional Commits](https://www.conventionalcommits.org/).

## [1.4.0] – 2026-11-25

LuckPerms rank rendering, custom rank displays and reliable client detection.

### Added
- **Formatted ranks:** LuckPerms prefixes and display names render with their colours and styles – legacy `&`/`§` codes, hex colours and MiniMessage – parsed into safe structured text (never HTML). One rank component is used on player profiles, player and online lists, the linked-account card, User Management and staff details; rank changes refresh through the existing realtime stream.
- **Rank display (Settings → Integrations → LuckPerms):** per LuckPerms group a custom display name or the LuckPerms prefix / display name / group name, text and background colour, bold, icon text or an uploaded icon (PNG, WebP, GIF, JPEG, ≤ 64 KB, content-checked), fallback text for resource-pack glyphs and a tooltip – with a live preview on light and dark backgrounds and a contrast warning. Appearance only; permissions are unaffected.
- **Client detection settings (Settings → Minecraft integration):** enable detection, optional NoRisk Client integration, raw brands for all staff, and debug logging that explains each detection step without IP addresses.
- **Optional NoRisk Client integration:** when the official NoRisk Client server API plugin is installed on the Velocity proxy, Nexora asks it whether a player uses NoRisk Client (looked up at runtime, nothing bundled). Not verified with a real NoRisk client yet.
- Connection history shows the client name (with a small monogram), protocol, and – for administrators or when enabled – the raw reported brand and the detection source; *Unknown* when nothing was reported.

### Fixed
- **Raw formatting codes in ranks:** a display name or prefix like `&4&lADMIN &4` was shown with its codes; it now shows as bold dark red *ADMIN*.
- **Missing client brands ("Client: —"):** the backend stored a brand only when it differed from the player's previous one, so a player rejoining with the same client got no brand on the new connection; and a brand sent before the proxy opened the session was dropped. Brands now belong to exactly the session that reported them, also arrive with the join and the proxy sync, are never overwritten by an empty brand and never copied from an earlier session.

### Database
- Migration `20261206000000_rank_display_client_detection` (additive): table `rank_displays`; `player_connections.client_name`, `client_source`, `client_detected_at`. Existing connections keep their brand and are normalised on read.

## [1.3.2] – 2026-11-25

### Added
- **Reason list in commands:** `/ban` and `/mute` without a reason (`/ban`, `/ban Steve`) show the usage and the ban or mute reasons the moderator may use – ID, name, readable duration or *Permanent* – following the global command mode (hybrid mode mentions typed reasons to moderators allowed to use them; typed-reasons-only mode shows the usage only). Restricted reasons are never listed, and the permission is checked again when a reason is used.
- `/nexora reasons <ban|mute|kick|warn> [page]` with pages of 8 reasons; `/nexora reasons` shows the first page per category with a pointer to the rest. Tab completion for the category.

### Changed
- Reason entries read `1 - Hacking (30 days)` with translated duration units (English and German).

## [1.3.1] – 2026-11-25

Sidebar polish and Minecraft player heads as account avatars.

### Added
- **Player heads as avatars:** accounts with a linked Minecraft account show the player's head (face and hat layer, custom skins included) in the sidebar, Settings, User Management and staff details. Resolved by the linked UUID through the existing server-side skin cache (`GET /api/account/minecraft-link/skin`, `GET /api/users/:id/minecraft-link/skin`), cached in the browser, with the default Nexora avatar as fallback for unlinked accounts and missing or invalid skins.
- **Linked account status:** Settings → General → Minecraft account shows the head, Minecraft name, UUID, rank, link date and status instead of the linking instructions once an account is linked.

### Fixed
- Sidebar footer: the language selector gets its own row and truncates long language names instead of squeezing the theme controls; version and theme share a row; the profile (avatar, username, role, sign-out) is a single aligned block. The sidebar stays in view on long pages and no longer overflows on narrow windows.
- User Management usernames no longer wrap inside the table.

## [1.3.0] – 2026-11-25

Punishment reason presets, LuckPerms integration and staff accounts, Nexora branding and a refreshed dashboard.

### Added
- **Punishment reason presets:** numbered ban, mute, kick and warning reasons (separate ID ranges, never reused after archiving) with player-facing reason, internal description, duration or permanent, required permission (default `nexora.punishment.<category>.<id>`), enabled state and order. Managed under Settings → Moderation → Punishment reasons (search, filter, sort, duplicate, disable, archive). Punishments store a snapshot of the reason used.
- **Network-wide command mode:** reason IDs only, typed reasons only, or hybrid – for every proxy, server, staff member and the dashboard, applied live. `/ban <player> <reason-id> [duration]`, permission-aware tab completion and `/nexora reasons`. Typed reasons in hybrid mode need `nexora.punishment.custom`, duration overrides `nexora.punishment.duration-override`, permanent overrides `nexora.punishment.permanent`; the backend enforces everything, also for edits.
- Dashboard punishment dialog with the reasons the user may use (duration fixed unless overrides are allowed); roles can grant individual reasons.
- **Optional LuckPerms integration** on the Velocity proxy: snapshots of groups, rank, prefix and the canonical permissions as LuckPerms evaluates them (inheritance, negated nodes, temporary nodes), event-driven with a five-minute reconciliation. Modes *Disabled*, *Hybrid* and *LuckPerms-managed staff*; stale data blocks sensitive actions.
- **Account linking:** `/nexora link` one-time codes (hashed, single use, 5 minutes, rate-limited); linking in Settings → General or staff registration on /register (optional).
- **Group → role mapping** with priorities and deny rules. LuckPerms-managed accounts change role with their groups, are disabled with all sessions revoked when no eligible group remains, and are re-enabled (fresh sign-in) when eligible again. The Owner role cannot be mapped; the protected Owner never depends on LuckPerms.
- **Staff management:** linked Minecraft account, rank, status, permission source and synchronisation in User Management; staff details with the per-reason permission matrix, account history, recheck, session revocation and unlinking.
- Player profiles show the Minecraft rank (validated colour, text only).

### Changed
- **Nexora branding:** plugins, messages (`[Nexora]` prefix), logs and the dashboard (name, subtitle, logo, favicon, titles). The Paper plugin's data folder moves from `plugins/NetworkManager/` to `plugins/Nexora/` automatically; the Velocity plugin id and folder are unchanged.
- **System** is the default theme (follows the operating system, also on sign-in pages); saved preferences are kept. Neutral light and dark palettes with one restrained accent, active-page indicator, language and theme controls in the sidebar.
- Error responses include safe detail fields (`reasonId`, `punishmentId`).

### Migration from 1.2.x
Additive migrations only. Upgraded installations keep typed reasons until the mode is changed; existing punishment templates become numbered reasons. Update all plugins before switching to hybrid or reason-ID mode. See [Updating](docs/installation/updating.md#upgrading-from-12x-to-130).

## [1.2.1] – 2026-11-25

Fixes the update checker staying at "GitHub rate limit reached … last known result from Never".

### Fixed
- After a GitHub rate limit, the next check now happens at GitHub's reset time. 1.2.0 waited a full check interval (6 hours) after a failed attempt, so an installation whose first check hit an exhausted quota showed no release information for hours.
- Failures other than rate limits retry after 15 minutes, 30 minutes, 1 hour, … instead of after the full interval; the last verified result is kept meanwhile.
- Secondary rate limits (`403`/`429` without rate-limit headers) are recognised; other `403` responses are reported as errors instead of rate limits.
- Settings → Updates no longer says "last known result from Never": without a successful check it explains that no release information has been retrieved yet and shows the last attempt and the next automatic attempt.

### Added
- Optional `GITHUB_TOKEN` for the update checker (60 → 5000 requests per hour). Without a token GitHub allows 60 requests per hour per public IP address, shared with every other program on the same network – a common reason for the rate limit. The token is only sent to `api.github.com`, never logged and never returned to the dashboard; a rejected token is reported.
- Redis cache and lock for the update state: all backend replicas share one result and only one sends a request; the database copy survives restarts. Dashboard page loads, notifications and plugin heartbeats never call GitHub.
- Conditional requests with `If-Modified-Since` in addition to `If-None-Match`.
- Clear verdict on Settings → Updates: *Up to date*, *Update available* or *Unable to verify*; GitHub access mode (with/without token) and the last rate-limit headers.

### Upgrade
Set `NEXORA_VERSION=1.2.1` (or keep `latest`), then `docker compose pull && docker compose up -d`. Optionally add `GITHUB_TOKEN=…` to `.env` (or the stack's environment variables). No database migration; the plugins are unchanged from 1.2.0 apart from the version number, so replacing them is optional.

## [1.2.0] – 2026-11-25

Update notifications and a standalone Docker Compose installation.

### Added
- **Update notifications.** The backend checks the GitHub Releases API for new stable releases (read-only, no token, every 6 hours, conditional requests, rate-limit aware) and caches the result; if GitHub is unreachable the last known result is kept and shown with its time. Versions are compared by semantic-version precedence; pre-releases only on the optional pre-release channel.
- **Settings → Updates** in the dashboard: installed backend and dashboard versions, latest release with date and release notes, last check, plugin version and status of every connected server, compatibility warnings, *Check for updates*, links to the release and to the plugin jars (only when the release has exactly these assets), and the update settings.
- Dashboard notification for administrators (bell and banner) with *Dismiss*, remembered per user and version; a newer release notifies again. Outdated plugins are also summarised on the Servers page.
- In-game: staff with `networkmanager.update.notify` are notified when they join the network (Velocity; at most once per configurable cooldown, not on server switches). `/nexora update` and `/nexora version` (`networkmanager.update.check`) show the installed and latest version, the status and the release link. Paper reports its version too and can notify networks without Velocity (`update-notifications=true`). Plugins never contact GitHub: the backend sends the cached data with each heartbeat response.
- Compatibility rules: plugins from another major/minor release are flagged as a version mismatch; releases can publish `minPluginVersion` and `minUpgradeFrom` (upgrade path) in their release notes.
- Permissions `updates.view`, `updates.notify`, `updates.check` (Owner, Administrator) and `updates.manage` (Owner).
- **Standalone deployment:** `docker-compose.yml` is self-contained – install with the Compose CLI, Portainer or Arcane without a release package, repository checkout, build or script. New guides for Portainer, Arcane, environment variables and moving existing installations; backup and restore commands that need only Docker.
- CI job *Standalone stack*: installs from nothing but `docker-compose.yml` and the published images, adopts an installation created with the v1.1.0 file, restarts, redeploys under another stack name with an env file (as Portainer/Arcane do), pins and unpins the version, diagnoses a wrong database password without logging secrets, and serves the built-in HTTPS profile.

### Changed
- README: terminal-based quick start first; Portainer and Arcane are documented as alternative methods.
- `docker-compose.yml` defaults to `NEXORA_VERSION=latest` (newest verified stable release; `latest` is only moved after a complete release run). Set e.g. `NEXORA_VERSION=1.2.0` to pin.
- No host files are needed anymore: GeoIP files are optional via `GEOIP_DIR` (default: an internal volume, geolocation off), and the built-in Caddy HTTPS configuration is generated from `DASHBOARD_DOMAIN`/`ACME_EMAIL` (`infrastructure/docker/Caddyfile` was removed).
- Data volumes have fixed names (`minecraft-network-manager_mysql-data`, …), identical to the volumes earlier versions created, so the data is found whatever the stack is called. `NEXORA_VOLUME_PREFIX` selects other volumes (second instance, custom project names).
- Explicit health checks for backend and dashboard in the Compose file; the Redis health check now fails on a wrong password; clearer messages for missing required variables.
- `/networkmanager` has the additional alias `/nexora`.

### Security
- Release notes are untrusted: the dashboard renders them as text with a small Markdown subset (no HTML), and only `https://` links are clickable. Nothing is downloaded or installed automatically. Manual checks are rate-limited; settings changes and manual checks are audit-logged.

### Migration from 1.1.0
The database migration only adds a column (`dashboard_users.dismissed_update_version`) and the update permissions. Back up, then replace `docker-compose.yml` with the new standalone file (or paste it into Portainer/Arcane) and keep your `.env` values; if you used `./geoip`, set `GEOIP_DIR=./geoip`. Pull and restart (`docker compose pull && docker compose up -d`) and replace both plugin jars. Grant `networkmanager.update.notify` / `networkmanager.update.check` to your staff in your proxy permission plugin. See [Updating](docs/installation/updating.md) and [Moving an existing installation](docs/installation/migration.md).

## [1.1.0] – 2026-11-25

Punishment editing and evidence management.

### Added
- **Edit punishments** after they were issued: reason, duration/expiry, permanent ↔ temporary and an internal staff note. Durations count from the original creation time. The dashboard shows a preview (old → new duration, expiry and reason) and asks for confirmation; concurrent edits are detected (optimistic locking, `409 STALE_PUNISHMENT`).
- In-game commands `/editban` and `/editmute` (`<player|#id> <duration|permanent|keep> [reason]`) with tab completion and the permissions `networkmanager.command.editban`/`editmute` (+ `.permanent`).
- **Evidence**: any number of entries per punishment (video, screenshot, image, link, text, note) with title, https URL, description and visibility (staff-only by default); can be added later, e.g. after an in-game ban; editing and soft-deletion with a configurable retention period (*Settings → Privacy*, default 90 days).
- **Change history**: immutable timeline of every change (created, reason changed, duration extended/shortened, made permanent/temporary, evidence added/edited/removed, revoked, reactivated) with actor, time, old/new values and note.
- Punishment detail page in the dashboard (linked from every punishment list), explicit **Reactivate** action for expired or revoked punishments.
- Optional *Require evidence* policy: active bans and mutes without evidence are flagged for review; they stay in force.
- Ban screens show the remaining time and an optional appeal link (*Settings → Plugin settings*, or `appeal-url` in `config.properties`). Evidence and staff notes are never shown to players.
- Permissions `punishments.edit`, `.edit.reason`, `.edit.duration`, `.edit.permanent`, `punishments.reactivate`, `punishments.evidence.view/add/edit/delete`, `punishments.history.view`; system roles receive suitable defaults.

### Changed
- Edits of active bans and mutes reach Velocity and Paper within about 3 seconds through the punishment feed. Editing an expired or revoked punishment never puts it back into force.

### Security
- Evidence URLs must be `https://` with a real host; `javascript:`, `data:`, `http:`, embedded credentials and control characters are rejected. Links are never fetched by the server and are rendered without previews or embeds. All changes are audit-logged; edit and evidence endpoints are rate-limited.

### Migration from 1.0.3
The migration is additive (new columns, the `punishment_history` table, permissions) and keeps all existing data. Back up, set `NEXORA_VERSION=1.1.0`, `docker compose pull && docker compose up -d`, then replace both plugin jars. See [Updating](docs/installation/updating.md#upgrading-from-103-to-110).

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

[1.4.0]: https://github.com/epicclowds/Nexora/releases/tag/v1.4.0
[1.3.2]: https://github.com/epicclowds/Nexora/releases/tag/v1.3.2
[1.3.1]: https://github.com/epicclowds/Nexora/releases/tag/v1.3.1
[1.3.0]: https://github.com/epicclowds/Nexora/releases/tag/v1.3.0
[1.2.1]: https://github.com/epicclowds/Nexora/releases/tag/v1.2.1
[1.2.0]: https://github.com/epicclowds/Nexora/releases/tag/v1.2.0
[1.1.0]: https://github.com/epicclowds/Nexora/releases/tag/v1.1.0
[1.0.3]: https://github.com/epicclowds/Nexora/releases/tag/v1.0.3
[1.0.2]: https://github.com/epicclowds/Nexora/releases/tag/v1.0.2
[1.0.0]: https://github.com/epicclowds/Nexora/releases/tag/v1.0.0
