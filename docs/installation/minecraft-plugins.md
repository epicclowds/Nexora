# Installing the Minecraft plugins

Nexora has two plugins. Both are ready-made `.jar` files – you never need to compile them.

| Plugin | File | Install on |
| --- | --- | --- |
| Velocity | `Nexora-Velocity-<version>.jar` | Your Velocity proxy (once) |
| Paper | `Nexora-Paper-<version>.jar` | Every Paper server behind the proxy |

## Compatibility

Every release is tested in CI by starting real servers with the plugins ([`infrastructure/compatibility.json`](../../infrastructure/compatibility.json)). Only these versions are tested:

| Component | Tested versions |
| --- | --- |
| Velocity | 4.3.1 |
| Paper (= Minecraft version) | 26.1.2, 26.2, 26.3 |
| Java on the Minecraft servers | 25 or newer |
| Nexora backend/dashboard | the **same release version** as the plugins |

Older Velocity 3.x or Paper 1.x servers are not supported (the plugins need the Velocity 4 / Paper 26 APIs and Java 25). Other versions may work but are not tested.

## 1. Download

1. Open the [Releases page](https://github.com/epicclowds/Nexora/releases) and pick the release that matches your Nexora installation (`NEXORA_VERSION` in `.env`, also shown at the bottom left of the dashboard).
2. Under **Assets**, download `Nexora-Velocity-<version>.jar` and `Nexora-Paper-<version>.jar` (or `nexora-plugins-<version>.zip`, which contains both plus example configurations).
3. Optional: check the files against `SHA256SUMS` from the same release: `sha256sum -c SHA256SUMS --ignore-missing`.

## 2. Velocity proxy

1. Stop the proxy and copy `Nexora-Velocity-<version>.jar` into its `plugins/` folder.
2. In the Nexora dashboard open **Settings → Minecraft integration → Add a server**, choose **Velocity (proxy)** and enter a name (e.g. `proxy`).
3. Check the options – the **Dashboard URL** must be reachable from the proxy (use `https://…` if the proxy is on another machine). Click **Create token & configuration**.
4. Click **Download config.properties** and save it as `plugins/networkmanager/config.properties` on the proxy (create the folder if it does not exist).
5. Start the proxy. The dashboard page shows *Registered* and then *Connected* within a few seconds; the proxy log shows `Registered with the backend as "proxy"`.

## 3. Paper servers

Repeat for **each** Paper server:

1. Stop the server and copy `Nexora-Paper-<version>.jar` into its `plugins/` folder.
2. In the dashboard: **Add a server** → **Paper (game server)**. Use **exactly the server name from your `velocity.toml`** (e.g. `lobby`, `survival`) – otherwise player server switches cannot be linked.
3. Adjust statistics, inventory and AntiCheat options if you like, then **Create token & configuration**.
4. Save the downloaded file as `plugins/Nexora/config.properties` on that server (before 1.3: `plugins/NetworkManager/`, which 1.3 moves automatically).
5. Start the server and wait for *Connected* in the dashboard.

Tokens are single-use and expire after 30 minutes. If one expired, simply add the server again.

## 4. Verify

- **Servers** page: every server shows *Online*, its Minecraft and plugin version, and a recent heartbeat (every 15 s).
- Join the network: the player appears under **Online players**; after the statistics interval (5 minutes by default) the player's **Statistics** tab fills.
- In the console or in game (permission `networkmanager.admin`): `/networkmanager` (aliases `/nm`, `/nexora`) shows the connection status.
- `/nexora update` (or `/nexora version`, permission `networkmanager.update.check`) shows the installed plugin version and the latest Nexora release.

## 5. Updating the plugins

1. Update the Nexora installation first ([Updating](updating.md)).
2. Download both jars of the **same** release, stop each server, delete the old `Nexora-*.jar` (or `NetworkManager-*.jar` from 1.0.0) and copy the new one into `plugins/`.
3. Start the servers. Configuration and credentials are kept (`plugins/networkmanager/` on Velocity; on Paper, 1.3 moves `plugins/NetworkManager/` to `plugins/Nexora/` once).

The dashboard marks servers whose plugin belongs to a different release with **Update recommended** (same major.minor) or **Update required** (different major.minor).

## Manual configuration (alternative)

Instead of downloading the generated file you can let the plugin create its default configuration:

1. Start the server once with the jar installed. The plugin creates `config.properties` and logs `Not registered with the backend`.
2. Create a registration token in the dashboard and edit the file:

   ```properties
   backend-url=https://admin.example.net   # dashboard address, no path
   registration-token=mnm_reg_...
   language=en-US
   ```

3. Restart. The token is exchanged for credentials stored in `credentials.properties` (keep this file secret). The token can then be removed from the config.

All options are documented in the generated `config.properties`. With `managed-settings=true` (default) the language, plugin messages, statistics and inventory options can be changed centrally under Settings → Plugin settings and apply without a restart; all other options require a restart.

| Option | Default | Platform |
| --- | --- | --- |
| `punishments-enabled` | `true` | Both: enforce network bans (proxy) and mutes (Paper) |
| `moderation-commands` | `true` | Velocity: register the in-game moderation commands |
| `managed-settings` | `true` | Both: accept centrally managed plugin settings |

## What is collected

| Source | Data |
| --- | --- |
| Velocity | join/leave times, server switches, username history, client protocol/version, client brand, virtual host, IP address (disable with `collect-ip-addresses=false`), proxy player count, memory, CPU |
| Paper | TPS, MSPT, player count, memory, CPU, players' game mode, player statistics (see [Statistics](../architecture/statistics.md); configurable or disable with `statistics-enabled=false`) |

Nothing is estimated: values that were not collected are shown as "not collected".

## Moderation

The Velocity plugin provides `/ban`, `/tempban`, `/unban`, `/mute`, `/tempmute`, `/unmute`, `/kick`, `/warn`, `/history`, `/check`, `/editban` and `/editmute`. Ban screens can show an appeal link: set it under *Settings → Plugin settings → Appeal link* or with `appeal-url=https://…` in `config.properties`. Permissions and behaviour are described in [Punishments](../architecture/punishments.md). Both plugins keep `punishments-cache.json` in their folder so bans and mutes stay enforced during backend outages; do not delete it while the backend is unreachable.

## Punishment reasons, LuckPerms and account linking

- **Reason IDs:** `/ban Steve 1` uses ban reason 1 from **Settings → Moderation → Punishment reasons**; `/ban` or `/mute` without a reason – and `/nexora reasons [category] [page]` – list the reasons you may use. Whether typed reasons are allowed is decided by the network-wide command mode. Details and permissions: [Punishments](../architecture/punishments.md#reason-presets-and-the-command-mode).
- **LuckPerms (optional):** install LuckPerms on the Velocity proxy (shared storage recommended when Paper servers run it too). The Nexora plugin detects it, synchronises staff permissions and ranks, and the dashboard can use them – see [LuckPerms](../architecture/luckperms.md).
- **Account linking:** staff run `/nexora link` and enter the code in the dashboard (Settings → General → Minecraft account, or /register when staff registration is enabled).

| Permission | Allows |
| --- | --- |
| `nexora.punishment.<ban|mute|kick|warn>.<id>` | Using a punishment reason |
| `nexora.punishment.custom` | Typed reasons in hybrid mode |
| `nexora.punishment.duration-override`, `nexora.punishment.permanent` | Changing a reason's duration / making it permanent |
| `nexora.command.reasons` | `/nexora reasons` |
| `nexora.dashboard.register` | `/nexora link` without a mapped staff group |

**Plugin name:** since 1.3 both plugins are called *Nexora*. The Velocity plugin keeps its id `networkmanager` (data folder `plugins/networkmanager/` unchanged). The Paper plugin's data folder becomes `plugins/Nexora/`: on the first start of 1.3, `plugins/NetworkManager/` is moved there automatically (configuration and credentials are kept), and plugins that depend on `NetworkManager` keep working.

## Update notifications

When the dashboard reports a newer Nexora release, staff with `networkmanager.update.notify` get a short message when they join the network (from the Velocity proxy, at most once per cooldown – default 24 hours, set under **Settings → Updates**). Players without the permission never see it. Paper servers do not notify by default, so nobody is notified twice; for a network without Velocity set `update-notifications=true` in the Paper plugin's `config.properties` (`false` disables it on any server). The plugins only read cached information from the backend – they never contact GitHub and never download or replace anything. Details: [Update notifications](../architecture/updates.md).

| Permission | Allows |
| --- | --- |
| `networkmanager.update.notify` | Update notification when joining |
| `networkmanager.update.check` | `/nexora update` / `/nexora version` |

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
| Server shows *Update required* | Install the plugin jar from the release that matches `NEXORA_VERSION` |
