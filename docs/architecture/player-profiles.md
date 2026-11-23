# Player profiles

Players are identified by their Minecraft UUID. Search accepts the current name, any previously recorded name, or the UUID (dashed or undashed).

## Profile tabs

| Tab | Content | Permission |
| --- | --- | --- |
| Overview | 3D skin, head, status, current server, playtime, connections, first join, client version/brand, game mode, name history, recent sessions | `players.view` |
| Statistics | Planned (Phase 5) | – |
| Inventory / Ender Chest | Planned (Phase 7) | – |
| Moderation | Active ban/mute, punish, history, revoke | `punishments.history` (+ issue/revoke permissions) |
| Connections | Connection history; IP addresses, IP summary and other accounts on the same IPs; approximate location | `players.view`; IPs `players.view.ip`; location `players.view.location` |
| Activity | Playtime in range, sessions, average session, daily playtime chart (7/30/90 days), weekday × hour heatmap | `players.view` |
| Notes | Internal staff notes | `players.notes` |

Values that were never collected (e.g. AFK time before Phase 5) are shown as "Not collected yet", never as zero.

## Skins

- The Velocity plugin sends the player's signed `textures` game-profile property at login. The backend stores the skin texture URL and arm model.
- `GET /api/players/:uuid/skin` returns the 64×64 PNG. The backend downloads textures **only** from `textures.minecraft.net` (strict allow-list; prevents server-side request forgery through crafted profiles), with a 5 s timeout and a 64 KB limit, verifies the PNG header and dimensions, and caches textures in Redis (30 days; texture URLs are content-addressed).
- If no texture was reported (e.g. players who have not joined since the update), premium UUIDs are resolved once via Mojang's session server (cached 6 h, negative results 1 h).
- The dashboard renders heads on a canvas (face + hat layer) and the 3D preview with [skinview3d](https://github.com/bs-community/skinview3d). Browsers never contact Mojang or other third parties.

## Activity

Computed on request from recorded sessions, in the viewer's time zone (account preference, otherwise the network default). Sessions are split into 5-minute slices and assigned to local days and weekday/hour buckets, so sessions crossing midnight or DST changes are attributed correctly.

## Connections and alternate accounts

The IP summary lists the player's addresses with connection counts and first/last use. "Other accounts on these IP addresses" lists accounts that connected from at least one of them. Shared networks (households, schools, VPNs, carrier-grade NAT) are common; the dashboard labels this as a hint, not proof.

## IP geolocation (optional)

Location data is only stored when MaxMind GeoLite2 databases are configured. It is approximate by nature and is always presented as such — never as an exact location.

1. Create a free MaxMind account and download **GeoLite2-City** and **GeoLite2-ASN** (`.mmdb`).
2. Place them in `./geoip/` next to `docker-compose.yml`.
3. In `.env`:

   ```dotenv
   GEOIP_CITY_DB=/geoip/GeoLite2-City.mmdb
   GEOIP_ASN_DB=/geoip/GeoLite2-ASN.mmdb
   ```

4. `docker compose up -d`. The backend log shows `GeoIP City database loaded`. Databases are reloaded automatically when the files change (e.g. updated by MaxMind's `geoipupdate`).

Lookups happen once, when a player connects; private and special-purpose addresses are skipped. Stored fields: country, region, city, autonomous system number and organisation (shown as network / ISP).

## Privacy and retention

*Settings → Privacy* sets how long IP addresses are kept (default 180 days, or "keep forever"). An hourly maintenance job (one backend replica at a time):

- removes IP addresses and virtual hosts from connection records older than the retention period (country and network stay),
- removes IP addresses from audit log entries older than the retention period,
- deletes dashboard sessions that expired more than 30 days ago.

Blacklist punishments keep their IP address, because enforcement depends on it. Revoke the blacklist to stop storing it.
