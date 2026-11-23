# Installing the Minecraft plugins

| Plugin | Jar | Platform | Java |
| --- | --- | --- | --- |
| Velocity | `NetworkManager-Velocity-<version>.jar` | Velocity 4.3+ | 25 |
| Paper | `NetworkManager-Paper-<version>.jar` | Paper 26.1+ | 25 |

Build them with `./gradlew build` (output in `apps/velocity-plugin/build/libs` and `apps/paper-plugin/build/libs`), or download the `minecraft-plugins` artifact from a CI run.

## 1. Generate the configuration (recommended)

Dashboard → **Settings → Minecraft integration** → *Add a server*:

1. Choose **Velocity** (one per proxy) or **Paper** (one per backend server) and enter the name. **Paper servers must use exactly the server name from `velocity.toml`** (e.g. `lobby`, `survival`), otherwise server switches cannot be linked to the server.
2. Adjust the options (connection, moderation, statistics, inventories, AntiCheat allow-list). The preview shows the resulting `config.properties`.
3. Click **Create token & configuration** and download the ZIP package (configuration + `INSTALL.md`) or `config.properties`.
4. Put the jar into `plugins/`, copy the configuration to `plugins/networkmanager/config.properties` (Velocity) or `plugins/NetworkManager/config.properties` (Paper) and start the server.

The dashboard page shows when the plugin has registered and when the first heartbeat arrived. Tokens are single-use and expire after 30 minutes (`REGISTRATION_TOKEN_TTL_MINUTES`). Details: [Configuration management](../architecture/configuration.md).

## 2. Manual configuration (alternative)

1. Put the jar into `plugins/` and start the server once. The plugin creates its `config.properties`.
2. Create a registration token in the same dashboard section and edit `config.properties`:

   ```properties
   backend-url=https://admin.example.net   # dashboard address, no path
   registration-token=mnm_reg_...
   language=en-US
   ```

3. Restart. The log shows `Registered with the backend as "<name>"`. The token is exchanged for credentials stored in `credentials.properties` (keep this file secret; it is created with owner-only permissions where supported). The token can then be removed from the config.

All options are documented in the generated `config.properties`. With `managed-settings=true` (default) the language, plugin messages, statistics and inventory options can be changed centrally under Settings → Plugin settings and apply without a restart; all other options require a restart.

| Option | Default | Platform |
| --- | --- | --- |
| `punishments-enabled` | `true` | Both: enforce network bans (proxy) and mutes (Paper) |
| `moderation-commands` | `true` | Velocity: register the in-game moderation commands |
| `managed-settings` | `true` | Both: accept centrally managed plugin settings |

## 3. Verify

- Dashboard → **Servers**: the server appears and switches to *Online* after the first heartbeat (every 15 s by default).
- In game or console: `/networkmanager` (alias `/nm`, permission `networkmanager.admin`) shows the connection status and the number of buffered events.

## What is collected

| Source | Data |
| --- | --- |
| Velocity | join/leave times, server switches, username history, client protocol/version, client brand, virtual host, IP address (disable with `collect-ip-addresses=false`), proxy player count, memory, CPU |
| Paper | TPS, MSPT, player count, memory, CPU, players' game mode, player statistics (see [Statistics](../architecture/statistics.md); configurable or disable with `statistics-enabled=false`) |

Nothing is estimated: values that were not collected are shown as "not collected".

## Moderation

The Velocity plugin provides `/ban`, `/tempban`, `/unban`, `/mute`, `/tempmute`, `/unmute`, `/kick`, `/warn`, `/history` and `/check`. Permissions and behaviour are described in [Punishments](../architecture/punishments.md). Both plugins keep `punishments-cache.json` in their folder so bans and mutes stay enforced during backend outages; do not delete it while the backend is unreachable.

## AntiCheat

Allow-list AntiCheat plugins with `anticheat-integrations=Grim,Vulcan` (Paper `config.properties`) and configure rules in the dashboard. Details: [AntiCheat](../architecture/anticheat.md).

## Inventories

The Paper plugin uploads inventory and Ender Chest snapshots on join, on quit and every `inventory-sync-interval-seconds` (default 300), and applies dashboard edits within a few seconds. Disable with `inventory-sync=false` / `enderchest-sync=false`. Details: [Inventory management](../architecture/inventory.md).

## Outages and restarts

- Player events are buffered in memory (default 50 000) while the backend is unreachable and delivered in order when it returns. If the buffer overflows, the oldest events are dropped and the proxy sends a full **sync** of all connected players, which repairs session state.
- The proxy also syncs every 60 seconds and after every reconnect.
- On a graceful shutdown the plugin delivers pending events and notifies the backend; open sessions are closed.
- If a proxy crashes, the backend closes its sessions after 3 minutes without a heartbeat (end time = last heartbeat).

## Credential management

On a server's detail page in the dashboard:

- **Rotate credentials** – issues a new key and revokes the old one. Replace `credentials.properties` with the displayed values and restart.
- **Revoke credentials** – disconnects the server until it registers again (delete `credentials.properties`, set a new token).
- **Disable** – the backend rejects the server's requests until re-enabled.

## Troubleshooting

| Log message | Cause / fix |
| --- | --- |
| `Not registered with the backend` | Set `registration-token` and restart |
| `Registration token was rejected` | Token expired or already used – create a new one |
| `The backend rejected this server's credentials` | Credentials were rotated or revoked – see above |
| `PLUGIN_AUTH_CLOCK_SKEW` (backend log) | Server clock differs by more than 5 minutes – enable NTP |
| Server switches show no server | Paper server name in the dashboard differs from `velocity.toml` – rename it on the server's detail page |
