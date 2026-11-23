# Configuration management

Configuration lives in three places, each with a clear owner:

| Where | Owner | Examples | Applies |
| --- | --- | --- | --- |
| `.env` (Docker host) | Operator | Secrets, ports, cookies, proxies, GeoIP | Restart of the stack |
| Dashboard → **Settings** (database) | Administrators | Network, plugin settings, punishment templates, languages, privacy, AntiCheat rules, roles | Immediately |
| `config.properties` on each Minecraft server | Server owner | Backend URL, AntiCheat allow-list, IP collection, intervals, moderation switches | Restart of that server |

Every dashboard change is audit-logged (`settings.*`, `i18n.*`, `anticheat.*`, `roles.*`).

## Settings sections

| Section | Permission | Contents |
| --- | --- | --- |
| General | – / `settings.manage` | Personal preferences; network name, description, Minecraft domain, dashboard URL |
| Minecraft integration | `servers.manage` | Add-server workflow, plugin config generator, unused registration tokens |
| Plugin settings | `settings.manage` | Settings pushed live to plugins, plugin message overrides |
| Moderation | `settings.manage` | Punishment templates (type, reason, duration) |
| Languages | `translations.manage` | Enable/disable, default language, add languages, import/export catalogues |
| Privacy | `settings.manage` | IP address retention |

AntiCheat rules (thresholds, durations, cooldowns, evidence) are configured on the AntiCheat page, roles and permissions under User Management.

## Adding a server (registration workflow)

Settings → **Minecraft integration** → *Add a server*:

1. **Server** – type (Velocity or Paper) and name. Paper servers must use exactly the name from `velocity.toml`.
2. **Options** – the generator shows every plugin option with its allowed range and a live preview of `config.properties`. "Connection mode" switches between HTTPS and plain HTTP; plain HTTP to a public address is flagged (requests are signed but not encrypted).
3. **Install & connect** – *Create token & configuration* creates a single-use registration token (valid `REGISTRATION_TOKEN_TTL_MINUTES`, default 30) and inserts it into the configuration. Download it as `config.properties` or as a ZIP package (`plugins/<folder>/config.properties` + `INSTALL.md`). The page then follows the registration live: plugin registered → first heartbeat received.

Downloads are generated in the browser; the token never appears in a URL. *Download without token* produces a configuration for reinstalling an already registered server. Rotating or revoking credentials and the connection status of registered servers are on the server's page (Servers → server).

## Plugin settings (central, live)

Plugins with `managed-settings=true` (default) take these values from the dashboard. Each field can be left at **Server setting**, which keeps the value from the server's own `config.properties`.

| Setting | Platform |
| --- | --- |
| Plugin language | Velocity, Paper |
| Plugin message overrides (per language) | Velocity, Paper |
| Statistics on/off, categories, interval | Paper |
| Inventory / Ender Chest synchronisation, snapshot interval | Paper |

How it reaches the servers:

1. Saving increments a **revision** (optimistic locking: a concurrent save by someone else is rejected with "changed in the meantime").
2. Every heartbeat response contains `configRevision`. A plugin whose applied revision differs fetches `GET /api/plugin/v1/config` and applies it **without a restart** (within one heartbeat interval, 15 s by default).
3. The plugin caches the last document in `managed-settings.json`, so it also applies when the server starts while the backend is unreachable.

Message overrides are validated: only known keys, no click/insertion/data MiniMessage tags (they could run commands), only placeholders the original text uses. Languages without a bundled plugin file use English plus their overrides.

### Requires a restart of the Minecraft server

`backend-url`, `registration-token`, `collect-ip-addresses`, `heartbeat-interval-seconds`, `sync-interval-seconds`, `max-queued-events`, `afk-timeout-seconds`, `anticheat-integrations`, `anticheat-max-reports-per-minute`, `punishments-enabled`, `moderation-commands`, `managed-settings`, `debug`. These are security- or infrastructure-relevant and deliberately stay under the server owner's control.

## Punishment templates

Settings → **Moderation** defines up to 50 templates (name, type, reason, duration for temporary types). The punishment dialog offers the templates matching the user's permissions and fills type, duration and reason; everything stays editable before issuing.

## Translation management

Settings → **Languages**:

- **Export** downloads the effective catalogue of a language (bundled + imported) as JSON.
- **Add language** registers a new locale (`ll-RR`). It starts disabled.
- **Import** uploads a JSON catalogue for any language. It is validated like the bundled files: no markup or scripts, balanced placeholders, only keys that exist in en-US. Missing keys fall back to English; the number of missing keys is shown. For bundled languages an import overrides the shipped texts (*Reset* returns to them).
- **Enable** makes the language selectable; the dashboard picks up imported texts within 30 seconds without a rebuild.
- **Delete** (added languages only) removes it; users who selected it fall back to the network default.

Workflow for a new language: export `en-US`, translate the values (keep keys and `{placeholders}`), add the language, import the file, enable it.

Plugin messages are translated separately under Plugin settings → Plugin messages (bundled files: `packages/translations/minecraft/<locale>.yml`).
