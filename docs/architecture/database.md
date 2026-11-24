# Database decision: MySQL 8.4 LTS

**Decision:** MySQL 8.4 LTS with Prisma 7 (via the `@prisma/adapter-mariadb` driver adapter).

**Considered:** PostgreSQL 17.

**Why MySQL:**

- The workload is relational and transactional (players, sessions, punishments, RBAC, audit log). Both engines fit; nothing in the requirements needs PostgreSQL-specific features (no full-text ranking, GIS or advanced JSON indexing).
- MySQL is what most Minecraft hosting providers and existing plugins (LiteBans, LuckPerms, CoreProtect) already use, so operators are familiar with backup and tuning.
- 8.4 is an LTS release with long support.
- Prisma supports both, so switching later is possible but would need a fresh migration history.

## Conventions

- Table and column names in `snake_case`; Prisma models in `PascalCase`.
- Timestamps are `DATETIME(3)` stored in **UTC** (the connection uses `timezone: 'Z'`). Display conversion happens in the dashboard.
- Minecraft UUID (`CHAR(36)`, lowercase, dashed) is the stable player identity and the primary key of `players`.
- Character set `utf8mb4` / `utf8mb4_unicode_ci`.
- High-volume tables (`player_sessions`, `player_connections`, `player_statistic_snapshots`, `audit_logs`) use `BIGINT` auto-increment keys; other entities use CUIDs.
- Secrets are never stored in plaintext: refresh tokens, registration tokens and plugin secrets are stored as SHA-256 hashes; passwords use Argon2id.

## Models

| Area | Tables |
| --- | --- |
| Players | `players`, `player_names`, `player_sessions`, `player_connections`, `player_server_visits`, `player_notes` |
| Statistics | `player_statistics` (current values; a missing row means *never collected*), `player_statistic_snapshots` (history for charts) |
| Inventories | `player_inventories` (latest snapshot + revision number), `inventory_revisions` (diffs, status: pending/applied/conflict/rolled back) |
| Punishments | `punishments` (with idempotency key), `punishment_evidence`, `anticheat_events` |
| Servers | `servers`, `server_credentials` (hashed), `registration_tokens` (hashed, single-use, expiring) |
| Dashboard | `dashboard_users`, `dashboard_roles`, `dashboard_permissions`, `dashboard_role_permissions`, `dashboard_sessions` |
| System | `audit_logs`, `system_settings`, `language_settings` |

Tables for later phases are created now so the schema evolves additively; they stay empty until the corresponding feature ships.

## Migrations

- Located in `apps/backend/prisma/migrations`, applied by `prisma migrate deploy` when the backend container starts.
- CI applies all migrations to an empty MySQL 8.4 and checks that the result matches `schema.prisma` (`prisma migrate diff --exit-code`).
- Migrations are **forward-only**. Never assume a migration can be rolled back automatically – back up before upgrading.
- Create a new migration during development with `npm run prisma:migrate:dev -w @mnm/backend -- --name <change>` (requires a local MySQL).

## Privacy & retention

IP addresses (`player_connections.ip_address`, `dashboard_sessions.ip_address`, `audit_logs.ip_address`) are personal data. Access to player IPs requires `players.view.ip`; geolocation fields are approximate and labelled as such. IP addresses are removed after the retention period configured under Settings → Privacy (default 180 days).
