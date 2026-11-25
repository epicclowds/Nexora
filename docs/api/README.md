# API

The backend exposes a REST API under `/api`. Interactive OpenAPI documentation is served at `/api/docs` (JSON: `/api/docs/openapi.json`) when `API_DOCS_ENABLED=true`.

## Conventions

- JSON request and response bodies; timestamps in ISO 8601 UTC; 64-bit ids as strings.
- Dashboard authentication via `mnm_access` cookie (or `Authorization: Bearer <access token>`).
- State-changing requests require the header `X-MNM-CSRF: 1` (except plugin endpoints).
- Errors: `{ "statusCode": 403, "code": "FORBIDDEN", "message": "...", "issues"?: [{ "path", "message" }] }`.
- Rate limits answer `429`.

## Endpoints

The complete list of routes with their required permissions is generated into the [permission matrix](../architecture/permission-matrix.md).

| Method & path | Auth | Permission | Purpose |
| --- | --- | --- | --- |
| `GET /api/health/live` | – | – | Liveness |
| `GET /api/health/ready` | – | – | Readiness (DB + Redis), `503` otherwise |
| `GET /api/setup/status` | – | – | Initialisation and service status |
| `POST /api/setup/initialize` | setup code | – | Create Owner + network settings (once) |
| `POST /api/auth/login` | – | – | Sign in (sets cookies) |
| `POST /api/auth/refresh` | refresh cookie | – | Rotate session tokens |
| `POST /api/auth/logout` | session | – | Revoke the current session |
| `GET /api/auth/me` | session | – | Current user, role and permissions |
| `PATCH /api/auth/me` | session | – | Language, theme, time zone preferences |
| `POST /api/auth/me/password` | session | – | Change password (revokes other sessions) |
| `GET /api/dashboard/summary` | session | – (sections by permission) | Home page figures |
| `GET /api/users` · `POST /api/users` · `PATCH /api/users/:id` | session | `users.view` / `users.manage` | Dashboard users |
| `GET /api/roles` · `GET /api/permissions` | session | `users.view` | Roles and permission catalogue |
| `POST /api/roles` · `PATCH /api/roles/:id` · `DELETE /api/roles/:id` | session | `roles.manage` | Custom roles and grants |
| `GET /api/audit-logs` | session | `audit.view` | Paginated audit trail (`action` prefix filter) |
| `GET /api/settings/network` · `PATCH` | session | – / `settings.manage` | Network settings |
| `GET /api/i18n/languages` | – | – | Enabled languages (managers see all + completeness) |
| `PATCH /api/i18n/languages/:locale` | session | `translations.manage` | Enable/disable, set default |
| `GET /api/i18n/languages/:locale/missing` · `GET /api/i18n/catalogs/:locale` | session | `translations.manage` | Missing keys, export |
| `GET /api/servers` | session | `servers.view` | Registered servers with live status |
| `GET/POST /api/servers/registration-tokens` · `DELETE …/:id` | session | `servers.manage` | Single-use registration tokens |
| `GET /api/servers/:id` · `PATCH` · `DELETE` | session | `servers.view` / `servers.manage` | Server detail, rename/enable/disable, delete |
| `POST /api/servers/:id/credentials/rotate` · `…/revoke` | session | `servers.manage` | Credential rotation (secret returned once) and revocation |
| `GET /api/players` | session | `players.view` | Search (name, previous name, UUID), `online`, `sort`, pagination |
| `GET /api/players/:uuid` | session | `players.view` (+ `players.view.ip` for IPs) | Profile, name history, recent sessions |
| `GET /api/players/:uuid/skin` | session | `players.view` | Skin PNG (server-side cached; 404 when unknown) |
| `GET /api/players/:uuid/activity?days=` | session | `players.view` | Daily playtime and weekday/hour heatmap |
| `GET /api/players/:uuid/connections` | session | `players.view` (+ `players.view.ip`, `players.view.location`) | Connection history, IP summary, related accounts |
| `GET /api/players/:uuid/statistics` · `…/statistics/series` · `GET /api/statistics/overview` · `…/leaderboard` | session | `players.view.statistics` | Statistics ([details](../architecture/statistics.md)) |
| `GET /api/anticheat/events` · `…/summary` · `GET/PUT …/settings` · `GET /api/players/:uuid/anticheat` | session | `anticheat.view` / `anticheat.manage` | AntiCheat ([details](../architecture/anticheat.md)) |
| `GET /api/players/:uuid/inventories` · `GET …/:server/inventory` · `GET …/:server/ender-chest` · `POST …/:server/refresh` | session | `players.view.inventory` | Inventory overview, snapshot and history, snapshot request ([details](../architecture/inventory.md)) |
| `POST /api/players/:uuid/inventories/:server/:kind/revisions` · `POST …/revisions/:id/rollback` · `…/cancel` | session | `players.edit.inventory` | Edit, roll back, cancel |
| `POST /api/auth/login/2fa` | public (challenge) | – | Second login step (TOTP or recovery code) |
| `GET /api/auth/me/2fa` · `POST …/setup` · `…/enable` · `…/disable` · `…/recovery-codes` | session | – | Own two-factor authentication |
| `GET/PUT /api/settings/plugins` · `GET …/plugins/messages` | session | `settings.manage` | Centrally managed plugin settings and message overrides ([details](../architecture/configuration.md)) |
| `GET /api/settings/moderation` · `PUT …` | session · `settings.manage` for PUT | – | Punishment templates |
| `POST /api/i18n/languages` · `DELETE …/:locale` · `PUT/DELETE /api/i18n/catalogs/:locale` | session | `translations.manage` | Add/delete languages, import/reset catalogues |
| `GET /api/i18n/messages/:locale` | public | – | Imported messages of an enabled language (used by the dashboard) |
| `GET /api/servers/registration-tokens/:id` | session | `servers.manage` | Registration progress (pending, registered, expired) |
| `GET/POST /api/moderation/presets` · `PATCH …/:id` · `POST …/:id/archive` · `POST …/:id/duplicate` | session | `punishments.presets.manage` | Punishment reasons ([punishments](../architecture/punishments.md#reason-presets-and-the-command-mode)) |
| `GET /api/moderation/presets/usable` | session | `punishments.history` | Reasons the current user may use, the mode and allowed overrides |
| `GET /api/moderation/presets/catalog` | session | `users.view` | Reasons with permissions (role editor) |
| `GET/PUT /api/moderation/command-mode` | session | `punishments.history` / `punishments.presets.manage` | Network-wide command mode |
| `GET /api/integrations/luckperms` · `PUT …/settings` · `POST/PUT/DELETE …/mappings` | session | `integrations.manage` | LuckPerms integration and role mapping ([LuckPerms](../architecture/luckperms.md)) |
| `GET /api/integrations/luckperms/rank-displays` · `PUT/DELETE …/:group` · `PUT/DELETE …/:group/icon` | session | `integrations.manage` | Rank displays per LuckPerms group, icon upload (base64 JSON, PNG/WebP/GIF/JPEG, ≤ 64 KB) ([LuckPerms](../architecture/luckperms.md#rank-display)) |
| `GET /api/rank-icons/:id` | session | – | Uploaded rank icon (inert image) |
| `GET/PUT /api/settings/client-detection` | session | `servers.manage` | Client detection settings ([player profiles](../architecture/player-profiles.md#client-detection)) |
| `GET/POST /api/account/minecraft-link` | session | – | Link the signed-in user's Minecraft account with a code |
| `GET /api/account/minecraft-link/skin` | session | – | Skin PNG of the signed-in user's linked account (avatar; 404 when unlinked or unavailable) |
| `GET /api/users/:id/minecraft-link/skin` | session | `users.view` | Skin PNG of a dashboard account's linked Minecraft account |
| `GET /api/auth/registration` · `POST /api/auth/register-linked` | public | – | Staff registration with a link code (when enabled; rate-limited) |
| `GET /api/users/:id/staff` · `POST …/staff/recheck` · `POST …/staff/revoke-sessions` · `DELETE …/minecraft-link` | session | `users.view` / `users.manage` | Staff details, permission matrix and actions |
| `GET /api/updates` | session | `updates.view` | Installed and latest versions, plugin versions per server, warnings, settings ([updates](../architecture/updates.md)) |
| `GET /api/updates/notification` · `POST …/notification/dismiss` | session | `updates.notify` | Update notification for the current user; dismiss it for a version |
| `POST /api/updates/check` | session | `updates.check` | Manual check (5/min; cached within one minute) |
| `GET/PUT /api/updates/settings` | session | `updates.view` / `updates.manage` | Update settings |
| `GET/PATCH /api/settings/privacy` | session | `settings.manage` | IP retention period, retention of removed evidence |
| `GET /api/punishments` | session | `punishments.history` | Search/filter punishments (`type`, `status`, `search`) |
| `POST /api/punishments` | session | per type (e.g. `punishments.ban`) | Issue a punishment |
| `POST /api/punishments/:id/revoke` | session | `punishments.unban` / `unmute` / … | Revoke an active punishment |
| `GET /api/punishments/:id` | session | `punishments.history` | Punishment details (`version`, `evidenceCount`, `needsReview`, …) |
| `PATCH /api/punishments/:id` | session | `punishments.edit` + issue permission + `punishments.edit.reason` / `.duration` / `.permanent` | Edit reason, expiry (`expiresAt`, `null` = permanent) and staff note; body needs the current `version` (`409 STALE_PUNISHMENT` otherwise) |
| `POST /api/punishments/:id/reactivate` | session | `punishments.reactivate` + issue permission | Put an expired or revoked punishment back into force |
| `GET /api/punishments/:id/history` | session | `punishments.history.view` | Immutable change history |
| `GET/POST /api/punishments/:id/evidence` | session | `punishments.evidence.view` / `.add` | List and add evidence |
| `PATCH/DELETE /api/punishments/:id/evidence/:evidenceId` | session | `punishments.evidence.edit` / `.delete` | Edit or remove (soft delete) evidence; body needs the evidence `version` |
| `GET /api/players/:uuid/punishments` | session | `punishments.history` | History and active ban/mute |
| `GET/POST /api/players/:uuid/notes` · `DELETE …/:noteId` | session | `players.notes` | Internal staff notes |
| `GET /api/events` | session | per event | Server-Sent Events stream ([realtime](../architecture/realtime.md)) |
| `POST /api/plugin/v1/register` | registration token | – | Plugin exchanges a token for a credential |
| `GET /api/plugin/v1/ping` · `POST …/heartbeat` · `…/events` · `…/sync` · `…/shutdown` | request signature | – | Plugin API ([protocol](../architecture/plugin-protocol.md)) |
| `POST /api/plugin/v1/anticheat/reports` | request signature | – | AntiCheat report |
| `POST /api/plugin/v1/inventories` · `GET …/inventories/pending` · `POST …/inventories/revisions/:id/result` | request signature (Paper) | – | Inventory snapshots and edits |
| `GET /api/plugin/v1/config` | request signature | – | Managed plugin settings (heartbeat and ping responses carry `configRevision`) |
| `POST /api/plugin/v1/statistics` | request signature (Paper) | – | Statistics upload |
| `GET /api/plugin/v1/punishments/active` · `…/changes?after=` · `POST …/punishments` · `…/punishments/revoke` · `…/punishments/edit` · `GET …/players/lookup` | request signature | – | Punishment feed and in-game moderation ([punishments](../architecture/punishments.md)) |

## Plugin registration

```http
POST /api/plugin/v1/register
Content-Type: application/json

{ "token": "mnm_reg_…", "pluginVersion": "0.2.0", "platformVersion": "Velocity 3.4.0", "minecraftVersion": "1.21.10" }
```

Response `201`:

```json
{ "serverId": "…", "serverName": "proxy", "serverType": "VELOCITY", "keyId": "mnm_key_…", "secret": "mnm_sk_…" }
```

The secret is returned once. Invalid, expired or reused tokens return `401`.
