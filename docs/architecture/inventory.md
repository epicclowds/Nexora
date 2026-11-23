# Inventory management

Staff can view and edit a player's **inventory** (41 slots: hotbar 0–8, main 9–35, boots/leggings/chestplate/helmet 36–39, offhand 40) and **Ender Chest** (27 slots) per Paper server from the player profile. Inventories are per server: every server keeps its own copy, so the dashboard selects the server first.

```
Paper plugin ──snapshot (join, quit, every 5 min, on request)──▶ backend (inventory_snapshots, revision n)
     ▲                                                              │
     │ GET pending (every 3 s)                                       │  dashboard edit (baseRevision n)
     │  ◀── revision: per-slot compare-and-set changes ─────────────┘  → inventory_revisions (PENDING)
     └── POST result: APPLIED / CONFLICT / REJECTED + fresh snapshot
```

## Edit safety

Items must never be duplicated or lost, even while the player is playing:

- **Optimistic lock.** An edit is based on the snapshot revision shown in the dashboard. If a newer snapshot arrived, the backend answers `409 STALE_REVISION` and the editor reloads.
- **One pending edit per inventory.** A second edit while one is waiting is refused (`409 PENDING_EDIT`); a pending edit can be cancelled.
- **Per-slot compare-and-set.** Every change carries the fingerprint (SHA-256 of the full serialized item) the slot must still contain. On the server, all slots are verified and all target items are built *before* any slot is touched, in a single main-thread task. If any slot changed in game, nothing is applied and the revision ends as `CONFLICT`.
- **No item data from the browser.** The dashboard never sends serialized items. Moving or editing an existing item references it by fingerprint (`base`); the backend resolves the stored item data and sends it to the server, so all components (formatting, attributes, custom data) survive. New items are created from the item ID only; the server validates material, stack size and enchantments (`REJECTED` with the reason otherwise).
- **Exactly once.** A revision that was applied but whose result could not be delivered is never applied again; the plugin re-sends the result until the backend acknowledges it.

Only the fields an editor changed are sent: name, lore and enchantments of an untouched item are kept exactly as they are. Names and lore entered in the dashboard are plain, non-italic text.

## Online and offline players

Edits for a player who is online on the selected server apply within a few seconds. Edits for offline players are queued and applied the next time the player joins **that** server; the dashboard shows the queued edit until then. "Request snapshot" asks the server for a fresh copy (only while the player is online there).

## Rollback and history

Every edit is a revision with author, reason, the changed slots and its outcome (`PENDING`, `APPLIED`, `CONFLICT`, `REJECTED`, `CANCELLED`, `ROLLED_BACK`). Rolling back an applied revision creates a new revision with the inverse changes, again protected by compare-and-set: if the items were changed afterwards, the rollback ends as a conflict instead of overwriting newer state.

## Permissions and audit

| Permission | Allows |
| --- | --- |
| `players.view.inventory` | Viewing inventories, Ender Chests and history, requesting snapshots |
| `players.edit.inventory` | Creating, cancelling and rolling back edits |

Audit actions: `inventory.edit_requested`, `inventory.rollback_requested`, `inventory.revision_cancelled`, `inventory.revision_applied`, `inventory.revision_conflict`, `inventory.revision_rejected`. Changes are pushed live to open dashboards (`inventory.changed`).

## Configuration (Paper `config.properties`)

| Option | Default | Meaning |
| --- | --- | --- |
| `inventory-sync` | `true` | Synchronise player inventories |
| `enderchest-sync` | `true` | Synchronise Ender Chests |
| `inventory-sync-interval-seconds` | `300` | Periodic snapshot interval (30–3600) |
