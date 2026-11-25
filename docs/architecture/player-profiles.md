# Player profiles

Players are identified by their Minecraft UUID. Search accepts the current name, any previously recorded name, or the UUID (dashed or undashed).

## Profile tabs

| Tab | Content | Permission |
| --- | --- | --- |
| Overview | 3D skin, head, rank, status, current server, playtime, connections, first join, client version, [client](#client-detection), game mode, name history, recent sessions | `players.view` |
| Statistics | Ranges, category values, daily charts, all-time breakdowns ([details](statistics.md)) | `players.view.statistics` |
| Inventory / Ender Chest | Per-server editor with history and rollback ([details](inventory.md)) | `players.view.inventory`; editing `players.edit.inventory` |
| Moderation | Active ban/mute, punish, history, revoke | `punishments.history` (+ issue/revoke permissions) |
| Connections | Connection history; IP addresses, IP summary and other accounts on the same IPs; approximate location | `players.view`; IPs `players.view.ip`; location `players.view.location` |
| Activity | Playtime in range, sessions, average session, daily playtime chart (7/30/90 days), weekday × hour heatmap | `players.view` |
| Notes | Internal staff notes | `players.notes` |

Values that were never collected (e.g. AFK time on networks without the Paper plugin) are shown as "Not collected yet", never as zero.

## Skins

- The Velocity plugin sends the player's signed `textures` game-profile property at login. The backend stores the skin texture URL and arm model.
- `GET /api/players/:uuid/skin` returns the 64×64 PNG. The backend downloads textures **only** from `textures.minecraft.net` (strict allow-list; prevents server-side request forgery through crafted profiles), with a 5 s timeout and a 64 KB limit, verifies the PNG header and dimensions, and caches textures in Redis (30 days; texture URLs are content-addressed).
- If no texture was reported (e.g. players who have not joined since the update), premium UUIDs are resolved once via Mojang's session server (cached 6 h, negative results 1 h).
- The dashboard renders heads on a canvas (face + hat layer) and the 3D preview with [skinview3d](https://github.com/bs-community/skinview3d). Browsers never contact Mojang or other third parties.

## Activity

Computed on request from recorded sessions, in the viewer's time zone (account preference, otherwise the network default). Sessions are split into 5-minute slices and assigned to local days and weekday/hour buckets, so sessions crossing midnight or DST changes are attributed correctly.

## Client detection

The client a player uses comes from evidence only:

1. **Client integration** – the official [NoRisk Client server API](https://docs.norisk.gg/) plugin, when installed on the Velocity proxy (optional; Nexora looks it up at runtime and does not bundle it). The proxy asks `isNrcPlayer` 2 and 8 seconds after login (after the client's handshake).
2. **Reported brand** – the `minecraft:brand` the client sends (Velocity `PlayerClientBrandEvent` / `Player#getClientBrand`), normalised to *Vanilla, Fabric, Quilt, Forge, NeoForge, NoRisk Client, Lunar Client, Badlion Client, Feather Client, LabyMod*.
3. Otherwise **Unknown**. The protocol version is never used to guess a client.

Each connection stores the raw brand, the normalised client, the detection source (`BRAND` or `INTEGRATION`) and the time. Brands are self-reported and can be changed by the player: they label the client, they are not a verified identity. The connection history shows the client with a small monogram (the name is always shown as text), the protocol and – for administrators with `servers.manage`, or everyone when enabled – the raw brand and the detection source.

**Settings → Minecraft integration → Client detection** (`servers.manage`): enable detection, the NoRisk integration, showing raw brands to all staff, and debug logging. The proxy receives the settings with every heartbeat. Debug lines (`[client-detection]` on the proxy, `Client detection:` in the backend log) name the session by the first 8 characters of its random key and never contain IP addresses; they distinguish *no brand received within 10 seconds*, *brand received but not a known client*, *brand for an unknown session dropped*, failed backend delivery (the connector's warnings) and failed database updates.

Paper servers behind the proxy are not needed for detection: the proxy sees the client's brand first-hand.

**Fixed in 1.4.0.** Brands were missing ("Client: —") for two reasons: the backend only stored a brand when it differed from the player's previous one, so a player who joined again with the same client (e.g. NoRisk Client) got no brand on the new connection; and modern clients can send their brand before the proxy's login handler had opened the session, so the brand event was dropped. Brands now belong to exactly the session that reported them, also arrive with the join (and the proxy sync), are never overwritten by an empty brand and never copied from a previous session.

## Connections and alternate accounts

The IP summary lists the player's addresses with connection counts and first/last use. "Other accounts on these IP addresses" lists accounts that connected from at least one of them. Shared networks (households, schools, VPNs, carrier-grade NAT) are common; the dashboard labels this as a hint, not proof.

## IP geolocation (optional)

Location data is only stored when MaxMind GeoLite2 databases are configured. It is approximate by nature and is always presented as such — never as an exact location.

1. Create a free MaxMind account and download **GeoLite2-City** and **GeoLite2-ASN** (`.mmdb`).
2. Put them in a folder on the Docker host, e.g. `/opt/nexora/geoip/`.
3. Set the variables (`.env` or the stack's environment variables):

   ```dotenv
   GEOIP_DIR=/opt/nexora/geoip            # host folder, mounted read-only at /geoip
   GEOIP_CITY_DB=/geoip/GeoLite2-City.mmdb
   GEOIP_ASN_DB=/geoip/GeoLite2-ASN.mmdb
   ```

4. Redeploy (`docker compose up -d`). The backend log shows `GeoIP City database loaded`. Databases are reloaded automatically when the files change (e.g. updated by MaxMind's `geoipupdate`).

Lookups happen once, when a player connects; private and special-purpose addresses are skipped. Stored fields: country, region, city, autonomous system number and organisation (shown as network / ISP).

## Privacy and retention

*Settings → Privacy* sets how long IP addresses are kept (default 180 days, or "keep forever"). An hourly maintenance job (one backend replica at a time):

- removes IP addresses and virtual hosts from connection records older than the retention period (country and network stay),
- removes IP addresses from audit log entries older than the retention period,
- deletes dashboard sessions that expired more than 30 days ago.

Blacklist punishments keep their IP address, because enforcement depends on it. Revoke the blacklist to stop storing it.
