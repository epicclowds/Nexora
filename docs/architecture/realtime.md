# Realtime updates

**Decision:** Server-Sent Events (SSE) at `GET /api/events`, fanned out across backend replicas with Redis pub/sub.

**Why not WebSockets (yet):** the dashboard is the single public entry point and proxies `/api` through a Next.js route handler. Route handlers stream responses (so SSE passes through unchanged) but cannot proxy WebSocket upgrades. SSE keeps the one-port deployment, works through Caddy/nginx without extra configuration, reconnects automatically, and the dashboard only needs server → client messages. If bidirectional messaging is required later (e.g. live inventory editing), a WebSocket endpoint can be added behind the reverse proxy.

## Flow

1. A domain change (heartbeat, join, leave, server update) calls `RealtimeService.publish()`, which publishes to the Redis channel `mnm:realtime`.
2. Every backend replica subscribes and forwards events to its connected SSE clients.
3. Each event is only sent to users holding the matching permission (`servers.view`, `players.view`). Payloads contain identifiers only; the dashboard refetches details through the normal, permission-checked API.
4. Streams send a keep-alive every 25 s and re-validate the dashboard session every 60 s, closing the stream after logout, deactivation or permission loss.
5. The dashboard keeps one `EventSource` per tab (`RealtimeProvider`). `useLiveRefresh()` debounces events and keeps a slow polling fallback.

`Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no` keep proxies and compression from buffering the stream.
