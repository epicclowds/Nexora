# Statistics

## Collection (Paper plugin)

Minecraft already records detailed per-player statistics; the plugin reads them instead of tracking events itself.

| Category | Values | Source |
| --- | --- | --- |
| Movement | walked, sprinted, crouched, swum, flown, elytra, boat, minecart, horse (cm), jumps | vanilla |
| Combat | PvP kills, mob kills, deaths, damage dealt/taken, kills per mob type | vanilla |
| Blocks | blocks mined/placed per type, totals | vanilla (`mined`, `used` for block items) |
| General | time on server, fish caught, items crafted/used | vanilla |
| General | active time, AFK time, chat messages, experience gained | plugin (stored in the player's persistent data, survives restarts) |

- **Active vs. AFK:** a player is AFK after `afk-timeout-seconds` (default 300) without moving their head, walking, interacting, building, chatting or using commands.
- **Chat messages** count only delivered messages (muted chat is not counted).
- **Experience gained** counts positive experience changes while the plugin is installed.
- **Performance:** a collection round runs every `statistics-interval-seconds` (default 300). Players are read on the main thread four per tick, so no single tick does all the work; uploads are asynchronous. Final values are also sent when a player leaves the server.
- **Data minimisation:** choose categories with `statistics-categories`, or disable collection entirely with `statistics-enabled=false`. Only non-zero values are sent.

Values are cumulative **per server** and sent as absolute numbers, so a failed upload is simply superseded by the next round.

## Storage (backend)

| Table | Content |
| --- | --- |
| `player_statistics` | Current value per player, server and key (all keys, incl. per block / mob type) |
| `player_statistic_snapshots` | Hourly history of the ~25 core statistics (one row per player, server, key and hour) |

Only changed values are written. The profile's *active playtime* and *AFK time* are updated from the plugin values (sum over servers).

## Ranges and charts

- **All time** uses the current values (sum over servers).
- **24 h / 7 d / 30 d / custom** sum the increments between hourly snapshots inside the range, starting from the last snapshot before the range. A value lower than its predecessor is treated as a counter reset (e.g. a new world), never as a negative contribution.
- If the range starts before collection began, the response is marked **partial** and the dashboard says so; earlier activity is never estimated.
- Ranges are precise to the hour. Breakdowns per block/mob type are available for all time only.
- Daily charts use the viewer's time zone.

## Dashboard

- Player profile → **Statistics** tab: range selector (24 h, 7 d, 30 d, all time, custom dates), category cards (distances in km, damage in hearts, times as durations, K/D = PvP kills per death), daily chart (blocks mined/placed, mob kills, deaths, distance walked, active time), all-time ore breakdown and most mined/placed blocks and killed mobs.
- **Statistics** page: network totals and leaderboards (active time, blocks mined/placed, kills, deaths, distance, elytra, fish, chat, jumps).
- Permission: `players.view.statistics`.

## API

| Endpoint | Purpose |
| --- | --- |
| `POST /api/plugin/v1/statistics` | Paper upload (signed): `{ capturedAt, players: [{ uuid, stats: { key: value } }] }`, max 50 players |
| `GET /api/players/:uuid/statistics?range=24h\|7d\|30d\|all\|custom&from&to` | Values, coverage, breakdowns |
| `GET /api/players/:uuid/statistics/series?keys=&days=` | Daily increments |
| `GET /api/statistics/overview` | Network totals |
| `GET /api/statistics/leaderboard?stat=&limit=` | Top players for one statistic |

Statistic keys are defined in `packages/shared-types/src/stats.ts`.
