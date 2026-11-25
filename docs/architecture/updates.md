# Update notifications

Nexora tells administrators and Minecraft staff when a newer release is available. It only **reads** release information: nothing is downloaded, installed or replaced automatically – no Docker images, no plugin jars, no code.

## How it works

```
GitHub Releases API ──(read-only, every 6 h, ETag)──▶ backend: UpdatesService (cache in the database)
                                                          │
                       ┌──────────────────────────────────┼─────────────────────────────┐
                 dashboard                         Velocity proxy                   Paper servers
     Settings → Updates, header notification   heartbeat response (cached)     heartbeat response (cached)
                                                join notification, /nexora update    /nexora update
```

- **One central check.** Only the backend contacts GitHub (`GET https://api.github.com/repos/epicclowds/Nexora/releases`), without a token, with a 10-second timeout, at most once per check interval (default 6 hours, configurable 1–168). Conditional requests (`If-None-Match`) mean an unchanged release list does not count against GitHub's rate limit. When GitHub reports a rate limit (`403`/`429` with `x-ratelimit-reset` or `Retry-After`), no request is sent before the reset time.
- **Last known result.** The result is stored in the database (`system_settings`), so it survives restarts. If GitHub cannot be reached, the dashboard shows the last known result with its time and the error (network, timeout, rate limit, HTTP error, invalid response).
- **Plugins never call GitHub.** Every heartbeat response contains the cached information (`update` field: latest version, whether the plugin's own version is older, release URL, check time, notification settings). Older backends without the field are handled: plugins keep their last known data.
- **Semantic versions.** Versions are compared by [SemVer](https://semver.org/) precedence – `1.10.0` is newer than `1.9.0`, `1.2.0-rc.1` is older than `1.2.0`. Tags that are not valid versions are ignored; drafts are ignored.
- **Channels.** *Stable* (default) never considers pre-releases (GitHub's pre-release flag **or** a version suffix such as `-rc.1`). *Pre-release* also offers release candidates and is meant for test networks.

## Components and versions

| Component | How the installed version is known |
| --- | --- |
| Backend | Its own version (image build) |
| Dashboard | Its own version (image build), shown in the sidebar and on Settings → Updates |
| Velocity / Paper plugins | Reported at registration and with every heartbeat; shown per server |

A component whose version cannot be determined (no heartbeat yet, development build) is shown as **Unknown** – never guessed. States: *Up to date*, *Outdated*, *Newer than release* (e.g. a pre-release on the stable channel), *Unknown*.

## Compatibility rules

Nexora does not assume compatibility. Warnings are based only on documented rules:

1. **Release policy:** backend, dashboard and both plugins of a release share one version number. A plugin from another **major or minor** version is shown as a *version mismatch* (its plugin protocol is not guaranteed to match); a different **patch** version is compatible but should be updated.
2. **Release metadata (optional):** a release can publish machine-readable rules in its release notes:

   ```html
   <!-- nexora-compatibility {"minPluginVersion":"1.2.0","minUpgradeFrom":"1.1.0"} -->
   ```

   - `minPluginVersion` – oldest plugin version that works with this backend release; older plugins are flagged.
   - `minUpgradeFrom` – oldest installed version that can upgrade directly (e.g. because of database migrations); older installations get an upgrade-path warning.

   The comment is invisible on GitHub and removed before release notes are shown in the dashboard. Invalid values are ignored.

## Dashboard

- **Notification** (users with `updates.notify`, when *Dashboard notifications* is on): a bell with a dot in the header and, once per browser session, a short banner. The dialog shows current and latest version, release date and release notes, with links to the release. **Dismiss** hides it for that version for this user (stored on the server); a newer release shows it again. The notification is loaded once per page load, not on every navigation.
- **Settings → Updates** (`updates.view`): latest version, release date, last successful check, backend and dashboard versions, a table of all servers with installed plugin version and status, warnings, *Check for updates* (`updates.check`, at most 5 per minute; checks within one minute return the cached result), *Release notes*, *GitHub Releases* and *Download* links for the plugin jars – only when the release has an asset with exactly the documented name (`Nexora-Velocity-<version>.jar`, `Nexora-Paper-<version>.jar`); otherwise the release page is the source.
- **Servers** page: a summary of servers running outdated plugins.
- **Update settings** (`updates.manage`): enable checks, check interval, channel, dashboard notifications, in-game notifications, in-game reminder cooldown, manual checks. Changes are audit-logged (`updates.settings_updated`, manual checks as `updates.checked`).

Release notes are untrusted content. They are rendered as text with a small Markdown subset (headings, lists, bold, code, links): HTML is never interpreted, and only `https://` links are clickable (opened with `rel="noopener noreferrer nofollow"`).

## Permissions

| Dashboard permission | Allows | Default roles |
| --- | --- | --- |
| `updates.view` | Settings → Updates, servers summary | Owner, Administrator |
| `updates.notify` | Dashboard update notification | Owner, Administrator |
| `updates.check` | Manual update check | Owner, Administrator |
| `updates.manage` | Update settings | Owner |

| Minecraft permission | Allows | Default |
| --- | --- | --- |
| `networkmanager.update.notify` | Notification when joining the network | Velocity: nobody (grant with your permission plugin); Paper: operators |
| `networkmanager.update.check` | `/nexora update`, `/nexora version` | Velocity: nobody; Paper: operators |

`networkmanager.admin` (connection status) also allows `/nexora update`. Players without these permissions never receive update messages.

## Minecraft

- **Join notification (Velocity).** Staff with `networkmanager.update.notify` receive the notification about three seconds after joining the network. It is sent once per *cooldown* (dashboard setting, default 24 hours) per player – reconnecting or switching servers does not repeat it. Velocity's login event fires once per network login, not per server switch.
- **Paper** reports its version like Velocity but does not notify by default, so players are not notified twice. Networks **without** a Velocity proxy can enable it with `update-notifications=true` in the Paper plugin's `config.properties` (`auto` = Velocity on, Paper off; `false` disables it locally).
- **Command:** `/nexora update` (also `/nexora version`, `/networkmanager update`, `/nm update`) shows the installed plugin version, the latest version, the status, when the backend last checked, and the release link. It uses the cached data only; if the backend has no information yet or checks are disabled, it says so.
- All texts are translatable (`update.*` keys in the plugin message catalogues and Settings → Plugin settings).

## Configuration reference

| Setting (Settings → Updates) | Default |
| --- | --- |
| Check for updates | on |
| Check every | 6 hours |
| Release channel | Stable |
| Dashboard notifications | on (users with `updates.notify`) |
| In-game notifications | on (staff with `networkmanager.update.notify`) |
| In-game reminder every | 24 hours |
| Manual checks | on |

Advanced: the environment variable `UPDATES_RELEASES_URL` points the backend at another releases API with the same format (e.g. an internal mirror). Air-gapped installations simply see "GitHub could not be reached" and keep working; disable the checks to hide it.
