# API

The backend exposes a REST API under `/api`. Interactive OpenAPI documentation is served at `/api/docs` (JSON: `/api/docs/openapi.json`) when `API_DOCS_ENABLED=true`.

## Conventions

- JSON request and response bodies; timestamps in ISO 8601 UTC; 64-bit ids as strings.
- Dashboard authentication via `mnm_access` cookie (or `Authorization: Bearer <access token>`).
- State-changing requests require the header `X-MNM-CSRF: 1` (except plugin endpoints).
- Errors: `{ "statusCode": 403, "code": "FORBIDDEN", "message": "...", "issues"?: [{ "path", "message" }] }`.
- Rate limits answer `429`.

## Endpoints (v0.2.0)

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
| `GET /api/events` | session | per event | Server-Sent Events stream ([realtime](../architecture/realtime.md)) |
| `POST /api/plugin/v1/register` | registration token | – | Plugin exchanges a token for a credential |
| `GET /api/plugin/v1/ping` · `POST …/heartbeat` · `…/events` · `…/sync` · `…/shutdown` | request signature | – | Plugin API ([protocol](../architecture/plugin-protocol.md)) |

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
