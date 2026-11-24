# Punishment system

## Types

| Type | Effect | Duration | Issued from |
| --- | --- | --- | --- |
| `BAN` / `TEMP_BAN` | Login denied network-wide; online player disconnected | permanent / 1 min – 10 years | commands, dashboard |
| `BLACKLIST` | Like a permanent ban, **plus** the player's last known IP address is blocked for all accounts | permanent | dashboard |
| `MUTE` / `TEMP_MUTE` | Chat blocked on every Paper server | permanent / 1 min – 10 years | commands, dashboard |
| `KICK` | Online player disconnected once (recorded, never "active") | – | commands, dashboard |
| `WARNING` | Message to the player, kept in history | – | commands, dashboard |

Every record stores: ID, target UUID, type, reason, created/expiry timestamps, issuer (dashboard user, player or console), source (`COMMAND`, `DASHBOARD`, `CONSOLE`, `ANTICHEAT`), server, status (`ACTIVE`, `EXPIRED`, `REVOKED`) and revocation details (who, when, why). Expiry is evaluated on read; no background job is needed.

**Duplicate prevention:** a player can have at most one active ban (incl. blacklist) and one active mute (`409 ALREADY_BANNED` / `ALREADY_MUTED`). Commands carry an idempotency key, so a retried request never creates a second punishment.

**Audit:** each issue, revocation and note is written to the audit log in the same transaction.

## Enforcement architecture

```
 command / dashboard / AntiCheat ──▶ backend (single source of truth) ──▶ punishment_changes (ordered feed)
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
| `/editban <player\|#id> <duration\|permanent\|keep> [reason]` | `networkmanager.command.editban` (+ `.permanent` to switch between permanent and temporary) |
| `/editmute <player\|#id> <duration\|permanent\|keep> [reason]` | `networkmanager.command.editmute` (+ `.permanent`) |

`/editban` and `/editmute` change the existing active punishment in place instead of creating a second one. Examples: `/editban Steve 30d Repeated cheating`, `/editban #clx0abcd1234 permanent`, `/editmute Steve keep Spamming links` (reason only). Durations are counted from the **original creation time**: `/editban Steve 30d` on a ban issued 10 days ago leaves 20 days. A duration that has already elapsed is rejected – use `/unban` instead. Tab completion offers players and common durations.

Staff with `networkmanager.notify` receive a message for every new punishment. Durations: `30m`, `12h`, `7d`, `2w`, `1mo` (30 days), `1y` and combinations such as `1d12h`. Targets can be names (players who have joined before) or UUIDs.

Assign permissions with your proxy permission plugin (e.g. LuckPerms). Dashboard permissions are separate and listed in [security.md](security.md).

## Dashboard

- **Moderation** page: all punishments with search (player, staff member, reason, ID), type and status filters, revoke action, "New punishment" dialog.
- **Player profile**: active ban/mute badges, punish dialog, full history with revoke, and internal staff notes (`players.notes`; authors or `dashboard.manage` may delete).
- Issue permissions: `punishments.ban` (ban/tempban), `punishments.mute`, `punishments.kick`, `punishments.warn`, `punishments.blacklist`; revoke: `punishments.unban`, `punishments.unmute`; viewing history: `punishments.history`.
- **Punishment detail page** (`/moderation/<id>`, linked from every table row): current values, evidence, change history and the actions *Edit punishment*, *Reactivate* and *Revoke*.

## Editing punishments (since 1.1.0)

Reason, duration/expiry, permanent ↔ temporary and the internal staff note can be changed after a punishment was issued – from the dashboard (`PATCH /api/punishments/:id`) or in-game (`/editban`, `/editmute`).

- **Durations count from creation.** "30 days" means `createdAt + 30 days`, not 30 days from now. The dashboard also accepts an exact expiry date in the user's time zone; the backend stores UTC.
- **Preview and confirmation.** The dashboard shows old → new values (duration, expiry, reason) and asks for confirmation before a material change is saved.
- **Optimistic locking.** Every punishment has a `version`. An edit based on an outdated version fails with `409 STALE_PUNISHMENT`, so two moderators cannot silently overwrite each other.
- **No accidental reactivation.** Expired and revoked punishments keep their status when their reason or note is corrected; their duration cannot be changed. Putting one back into force is a separate action (*Reactivate*, `punishments.reactivate`) that requires a new expiry and a note, and fails if the player already has another active ban/mute.
- **Live sync.** Changes to an active ban or mute are published on the plugin feed (`UPDATED`/`REACTIVATED`) and applied on Velocity and Paper within about 3 seconds – the ban screen and mute checks use the new values without a restart. Corrections to inactive punishments are not published, so older plugins can never re-enforce them.
- Permissions: `punishments.edit` plus the issue permission of the type, and per field `punishments.edit.reason`, `punishments.edit.duration`, `punishments.edit.permanent` (switching between permanent and temporary). Kicks and warnings have no duration.

## Evidence

A punishment can have any number of evidence entries – also added later, e.g. after an in-game ban.

| Type | Content |
| --- | --- |
| `VIDEO`, `SCREENSHOT`, `IMAGE`, `LINK` | https URL (YouTube, Medal, Imgur, …) plus optional description |
| `TEXT` | Text, e.g. chat logs |
| `NOTE` | Internal note (always staff-only) |

- Fields: title, URL, description, visibility (`STAFF` by default, or `PUBLIC`), creator and editor with timestamps. AntiCheat evidence is created automatically and cannot be edited.
- **Security:** only `https://` URLs with a real host; `javascript:`, `data:`, `http:`, embedded credentials and control characters are rejected. Links are rendered as plain text links with `rel="noopener noreferrer nofollow"` – no embeds, no previews, and the server never fetches them. Descriptions are rendered as text (no HTML).
- **Removal is a soft delete.** Removed evidence disappears from the dashboard immediately; its content is deleted permanently after the retention period (*Settings → Privacy*, default 90 days). The history keeps that it existed.
- **Never shown to players.** Ban screens, kick messages and chat messages never contain evidence or staff notes.
- Optional policy *Require evidence* (*Settings → Moderation*): active bans and mutes without evidence are flagged *needs review* in the dashboard. They stay in force, so in-game bans keep working and evidence can be attached afterwards.
- Permissions: `punishments.evidence.view`, `.add`, `.edit`, `.delete`.

## Change history

Every change is stored in the immutable `punishment_history` table (who, when, old → new values, optional note): `CREATED`, `REASON_CHANGED`, `DURATION_EXTENDED`, `DURATION_SHORTENED`, `MADE_PERMANENT`, `MADE_TEMPORARY`, `NOTE_CHANGED`, `EVIDENCE_ADDED`, `EVIDENCE_UPDATED`, `EVIDENCE_REMOVED`, `REVOKED`, `REACTIVATED`. The dashboard shows it as a timeline (`punishments.history.view`). Existing punishments received a `CREATED` (and, if revoked, a `REVOKED`) entry during the 1.1.0 migration. All edits are additionally recorded in the audit log.

## Ban screen

The ban screen shows the current reason, the expiry with the remaining time, the punishment ID and – if configured under *Settings → Plugin settings → Appeal link* (or `appeal-url` in `config.properties`) – an appeal link. Texts come from the translation files (`punishment.*`), so they follow the configured language.
