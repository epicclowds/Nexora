# AntiCheat integration

The Network Manager does not detect cheats itself. It connects existing AntiCheat plugins (Grim, Vulcan, …) to the network-wide punishment system: integrations **report** violations, and the network's **rules** — configured in the dashboard — decide what happens.

```
AntiCheat plugin ──Java API / /anticheatban──▶ Paper plugin ──signed report──▶ backend rule engine
                                                  │ (allow-list, rate limit)          │
                                                  └─ kicks locally on KICK/BAN        ├─ anticheat_events (every report + outcome)
                                                                                      └─ punishment (source ANTICHEAT, evidence)
                                                                                             └─▶ punishment feed ─▶ proxy enforces
```

## Safe defaults

- Automatic reports for checks **without a rule are only logged**. Nothing is punished until you add rules.
- `/anticheatban` without a matching rule uses the *command fallback* (default: 30-day temporary ban).
- The example rules from the specification (Speed → 30 days, Fly → 14 days, KillAura → permanent) are **not active**; the dashboard offers them as a template ("Insert example rules") to review and save.

## Rules (Dashboard → AntiCheat → Rules)

| Setting | Meaning |
| --- | --- |
| Check | Name reported by the integration, matched case-insensitively |
| Action | Log only, warning, kick, temporary ban (with duration), permanent ban |
| Min. VL | Automatic reports below this violation level are only logged (explicit `/anticheatban` ignores it) |
| Cooldown | No further automatic punishment for the same player and check within this window |
| AntiCheat punishments enabled | Global switch; reports are still recorded when off |
| Store evidence and metadata | Keep evidence text and details with events and punishments |
| Max. automatic punishments per server and minute | Protects against misbehaving integrations |

Changes apply to the next report; no plugin reload is needed. Every change is audit-logged (`anticheat.settings_updated`). Viewing requires `anticheat.view`, editing `anticheat.manage`.

## Outcomes

Each report is stored with one outcome: `WARNING`, `KICK`, `TEMP_BAN`, `BAN` (punishment issued) or `LOGGED`, `DISABLED`, `SKIPPED_THRESHOLD`, `SKIPPED_COOLDOWN`, `SKIPPED_RATE_LIMIT`, `SKIPPED_DUPLICATE` (player already banned), `SKIPPED_OFFLINE` (kick of an offline player).

Punishments are issued through the regular punishment service (source `ANTICHEAT`, issuer `AntiCheat (<integration>)`) with the evidence attached, appear in the moderation views, and are enforced network-wide by the proxy within seconds. The Paper server additionally disconnects the player immediately on kick or ban.

## For AntiCheat plugin developers

Add the Paper plugin jar as a `compileOnly` dependency and declare a soft dependency on `Nexora` in your `plugin.yml` (`NetworkManager` keeps working: the plugin still provides that name).

```java
AntiCheatApi api = Bukkit.getServicesManager().load(AntiCheatApi.class);
if (api != null && api.isAuthorized(this)) {
    api.report(this, AntiCheatReport.builder(player.getUniqueId(), "Speed")
            .violationLevel(vl)
            .evidence("moved " + speed + " blocks/s")
            .metadata("ping", player.getPing())
            .build())
       .thenAccept(result -> getLogger().info("Outcome: " + result.outcome()));
}
```

- `report` is asynchronous and never blocks the calling thread.
- The server owner must allow-list your plugin: `anticheat-integrations=YourPlugin` in `plugins/Nexora/config.properties`.
- Reports are rate limited per integration (`anticheat-max-reports-per-minute`, default 120).
- Retries after network errors reuse the same event key, so a report never causes two punishments.

## `/anticheatban <player> <cheatType> <reason>`

For integrations that can only run commands. Requires `networkmanager.anticheat.command` (default **false**; the console always has it), so regular players and moderators cannot use it unless explicitly granted.

## API

| Endpoint | Purpose |
| --- | --- |
| `POST /api/plugin/v1/anticheat/reports` | Signed report from a Paper server |
| `GET /api/anticheat/events` · `GET /api/players/:uuid/anticheat` | Event history (`anticheat.view`) |
| `GET /api/anticheat/summary` | Today's counters, top checks, integrations |
| `GET/PUT /api/anticheat/settings` | Rules (`PUT` requires `anticheat.manage`) |
