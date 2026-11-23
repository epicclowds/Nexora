# Punishment system

## Types

| Type | Effect | Duration | Issued from |
| --- | --- | --- | --- |
| `BAN` / `TEMP_BAN` | Login denied network-wide; online player disconnected | permanent / 1 min – 10 years | commands, dashboard |
| `BLACKLIST` | Like a permanent ban, **plus** the player's last known IP address is blocked for all accounts | permanent | dashboard |
| `MUTE` / `TEMP_MUTE` | Chat blocked on every Paper server | permanent / 1 min – 10 years | commands, dashboard |
| `KICK` | Online player disconnected once (recorded, never "active") | – | commands, dashboard |
| `WARNING` | Message to the player, kept in history | – | commands, dashboard |

Every record stores: ID, target UUID, type, reason, created/expiry timestamps, issuer (dashboard user, player or console), source (`COMMAND`, `DASHBOARD`, `CONSOLE`, later `ANTICHEAT`), server, status (`ACTIVE`, `EXPIRED`, `REVOKED`) and revocation details (who, when, why). Expiry is evaluated on read; no background job is needed.

**Duplicate prevention:** a player can have at most one active ban (incl. blacklist) and one active mute (`409 ALREADY_BANNED` / `ALREADY_MUTED`). Commands carry an idempotency key, so a retried request never creates a second punishment.

**Audit:** each issue, revocation and note is written to the audit log in the same transaction.

## Enforcement architecture

```
 command / dashboard ──▶ backend (single source of truth) ──▶ punishment_changes (ordered feed)
                                                                  │  poll every 3 s (cursor = id)
                              ┌───────────────────────────────────┴───────────────────────┐
                        Velocity plugin                                             Paper plugin
              local cache: bans, blacklists, mutes                        local cache: mutes
              • LoginEvent: deny from cache (no network call)             • AsyncChatEvent: block muted players
              • new ban / kick / warning / mute: act on online players
              • staff notification (networkmanager.notify)
```

- **No network round-trip on login.** Bans are checked against the in-memory cache, so a slow or unavailable backend never delays or blocks joins.
- **Outage-safe.** The cache is written to `punishments-cache.json` in the plugin folder. After a restart without backend connectivity the last known bans and mutes are still enforced. When the backend is reachable the plugin loads a fresh snapshot and continues with the feed.
- **Fast propagation.** Dashboard punishments reach every proxy within about 3 seconds. Commands apply their effect locally immediately after the backend confirms.
- **Old events are not replayed to players.** Changes older than 2 minutes (e.g. after an outage) update the cache but do not kick or message anyone.
- **Mutes are enforced on Paper**, because Velocity cannot cancel signed chat messages from modern clients.
- **Commands require the backend.** If it is unreachable, commands fail with a clear message instead of creating local-only punishments that could diverge.

Blacklist entries include an IP address, which is personal data. It is only sent to authenticated plugins (for enforcement) and shown in the dashboard only where `players.view.ip` applies.

## In-game commands (Velocity)

| Command | Permission |
| --- | --- |
| `/ban <player> <reason>` | `networkmanager.command.ban` |
| `/tempban <player> <duration> <reason>` | `networkmanager.command.tempban` |
| `/unban <player> [reason]` | `networkmanager.command.unban` |
| `/mute <player> <reason>` | `networkmanager.command.mute` |
| `/tempmute <player> <duration> <reason>` | `networkmanager.command.tempmute` |
| `/unmute <player> [reason]` | `networkmanager.command.unmute` |
| `/kick <player> <reason>` | `networkmanager.command.kick` |
| `/warn <player> <reason>` | `networkmanager.command.warn` |
| `/history <player>` | `networkmanager.command.history` |
| `/check <player>` | `networkmanager.command.check` |

Staff with `networkmanager.notify` receive a message for every new punishment. Durations: `30m`, `12h`, `7d`, `2w`, `1mo` (30 days), `1y` and combinations such as `1d12h`. Targets can be names (players who have joined before) or UUIDs.

Assign permissions with your proxy permission plugin (e.g. LuckPerms). Dashboard permissions are separate and listed in [security.md](security.md).

## Dashboard

- **Moderation** page: all punishments with search (player, staff member, reason, ID), type and status filters, revoke action, "New punishment" dialog.
- **Player profile**: active ban/mute badges, punish dialog, full history with revoke, and internal staff notes (`players.notes`; authors or `dashboard.manage` may delete).
- Issue permissions: `punishments.ban` (ban/tempban), `punishments.mute`, `punishments.kick`, `punishments.warn`, `punishments.blacklist`; revoke: `punishments.unban`, `punishments.unmute`; viewing history: `punishments.history`.
