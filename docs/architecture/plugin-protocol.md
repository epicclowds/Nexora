# Plugin protocol

Velocity and Paper plugins talk to the backend over HTTPS JSON (`/api/plugin/v1/*`), usually through the dashboard URL (the dashboard proxies `/api`). Implementation: `apps/plugin-common` (Java) and `apps/backend/src/plugin-api` (TypeScript).

## Registration

`POST /api/plugin/v1/register` with a single-use token → `{ keyId, secret, serverId, serverName, serverType }`. The backend stores only `SHA-256(secret)`.

## Request signing

Every other request is signed:

```
signingKey = SHA-256(secret)                    (32 raw bytes)
canonical  = METHOD "\n" PATH "\n" TIMESTAMP "\n" NONCE "\n" hex(SHA-256(body))
signature  = hex(HMAC-SHA256(signingKey, canonical))
```

Headers: `X-MNM-Key-Id`, `X-MNM-Timestamp` (epoch ms), `X-MNM-Nonce` (16–64 chars `[A-Za-z0-9_-]`), `X-MNM-Signature`.

The backend rejects requests when the key is unknown or revoked, the timestamp is more than 5 minutes off, the signature does not match the exact raw body, or the nonce was already used (nonces are kept in Redis for 10 minutes → **replay protection**). Disabled servers get `403`.

A fixed test vector is asserted on both sides (`apps/backend/test/plugin.spec.ts`, `RequestSignerTest.java`) so the implementations cannot drift apart.

*Trade-off:* the HMAC key is the stored hash, so someone with read access to the database could sign requests. Database access already implies full compromise of the platform; the design ensures the secret is never transmitted after registration and captured requests cannot be replayed or altered.

## Endpoints

| Endpoint | Sender | Purpose |
| --- | --- | --- |
| `GET /ping` | both | Verify credentials and clock |
| `POST /heartbeat` | both | Status and metrics; Paper also sends players' game modes. The response to Velocity carries `clientDetection` (`enabled`, `debug`, `norisk`, `showRawBrand`) |
| `POST /events` | Velocity | Ordered batch (≤ 500) of `player.join` (optional `brand` when the client reported it before login completed), `player.switch`, `player.brand`, `player.client` (client confirmed by a client's server API: `client`, `source: "INTEGRATION"`), `player.leave` |
| `POST /sync` | Velocity | Complete list of connected sessions (with the client brand when known); backend closes missing and opens unknown sessions |
| `POST /shutdown` | both | Marks the server offline; Velocity's open sessions are closed |

## Idempotency and ordering

- The proxy generates a random **session key** (UUID) per login. Join, switch and leave events reference it; the backend ignores a join whose key exists and a leave for an already closed session. Retried batches therefore never duplicate data (`{ applied, skipped }` in the response). Brand and client events update only the connection of their own session; repeated or empty brands are skipped.
- Events carry the time they happened (`at`, epoch ms), so buffered events keep correct timestamps. Times in the future are clamped to the backend clock.
- One sender thread per plugin delivers batches strictly in order; a batch is removed from the buffer only after the backend acknowledged it. A batch rejected as invalid (`400`) is dropped and a sync is scheduled so the queue cannot block forever.

## Failure handling

| Situation | Behaviour |
| --- | --- |
| Backend unreachable | Exponential backoff (1 s → 60 s), events stay buffered |
| Buffer full | Oldest events dropped, full sync after reconnect |
| Proxy crash | Backend closes its sessions after 3 min without heartbeat (`StaleServerMonitor`, one replica at a time via Redis lock) |
| Server silent > 60 s | Reported as *Offline* |
| Player on two proxies | A player is online while any session is open |
