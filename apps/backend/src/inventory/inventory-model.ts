import { z } from 'zod';

/**
 * Inventory snapshots and edits. Every slot change is a compare-and-set on the
 * server: "slot N holds fingerprint X → replace it". The Paper plugin applies
 * all changes of a revision or none, so concurrent changes by the player can
 * never duplicate or delete items.
 */
export type Kind = 'INVENTORY' | 'ENDER_CHEST';
/** Player inventory: 0–8 hotbar, 9–35 main, 36–39 armor (boots → helmet), 40 offhand. Ender chest: 0–26. */
export const SLOT_COUNT: Record<Kind, number> = { INVENTORY: 41, ENDER_CHEST: 27 };

const fingerprint = z.string().regex(/^[0-9a-f]{64}$/);
const itemId = z.string().regex(/^[a-z0-9_.-]+:[a-z0-9_./-]+$/).max(128);
const enchantments = z
  .record(itemId, z.number().int().min(1).max(255))
  .refine((e) => Object.keys(e).length <= 64, 'Too many enchantments');
const name = z.string().max(100);
const lore = z.array(z.string().max(200)).max(20);

/** Item as reported by the plugin (incl. full-fidelity serialized data). */
export const snapshotItemSchema = z.object({
  slot: z.number().int().min(0).max(40),
  id: itemId,
  amount: z.number().int().min(1).max(127),
  name: name.nullable().optional(),
  lore: lore.optional(),
  enchantments: enchantments.optional(),
  damage: z.number().int().min(0).optional(),
  maxDamage: z.number().int().min(0).optional(),
  fp: fingerprint,
  /** Base64 of ItemStack#serializeAsBytes (≤ 64 KiB). */
  data: z.string().max(87_400),
});
export type SnapshotItem = z.infer<typeof snapshotItemSchema>;

export const snapshotSchema = z.object({ items: z.array(snapshotItemSchema).max(41), fp: fingerprint });
export type Snapshot = z.infer<typeof snapshotSchema>;

/** Desired slot content from the dashboard. Raw item data is never accepted from clients. */
export const editItemSchema = z.object({
  id: itemId,
  amount: z.number().int().min(1).max(99),
  /** undefined = keep (when based on an existing item), null = remove the custom name. */
  name: name.nullable().optional(),
  lore: lore.optional(),
  enchantments: enchantments.optional(),
  /** Fingerprint of an existing item of this player and server to start from (keeps all other components). */
  base: fingerprint.optional(),
});
export type EditItem = z.infer<typeof editItemSchema>;

export const editSchema = z.object({
  baseRevision: z.number().int().min(0),
  reason: z.string().trim().max(500).optional(),
  changes: z
    .array(z.object({ slot: z.number().int().min(0).max(40), before: fingerprint.nullable(), after: editItemSchema.nullable() }))
    .min(1)
    .max(100)
    .refine((c) => new Set(c.map((x) => x.slot)).size === c.length, 'Each slot may only be changed once'),
});
export type EditInput = z.infer<typeof editSchema>;

/** A resolved change as stored and delivered to the plugin. */
export interface ResolvedChange {
  slot: number;
  before: string | null;
  beforeItem: SnapshotItem | null;
  after: (EditItem & { data?: string }) | null;
  /** Fingerprint after application (filled in from the plugin's result). */
  afterFp?: string | null;
}

export class InventoryEditError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Validates an edit against the current snapshot and resolves `base` items to
 * their server-side data. `pool` holds all known items of this player on this
 * server (inventory and ender chest) so items can be moved between them.
 */
export function resolveEdit(kind: Kind, current: Snapshot, pool: SnapshotItem[], input: EditInput): ResolvedChange[] {
  const bySlot = new Map(current.items.map((i) => [i.slot, i]));
  return input.changes.map((change) => {
    if (change.slot >= SLOT_COUNT[kind]) throw new InventoryEditError('INVALID_SLOT', `Slot ${change.slot} does not exist`);
    const existing = bySlot.get(change.slot) ?? null;
    if ((existing?.fp ?? null) !== change.before) {
      throw new InventoryEditError('STALE_SLOT', `Slot ${change.slot} changed since the snapshot was loaded`);
    }
    let after: ResolvedChange['after'] = null;
    if (change.after) {
      after = { ...change.after };
      if (change.after.base) {
        const base = pool.find((i) => i.fp === change.after!.base);
        if (!base) throw new InventoryEditError('UNKNOWN_BASE_ITEM', 'The referenced item is not part of this player\'s inventories');
        if (base.id !== change.after.id) throw new InventoryEditError('BASE_TYPE_MISMATCH', 'The item type of a based item cannot be changed');
        after.data = base.data;
      }
    }
    return { slot: change.slot, before: change.before, beforeItem: existing, after };
  });
}

/** Inverse of an applied revision: restores every slot's previous item exactly (from its serialized data). */
export function inverseChanges(applied: ResolvedChange[]): ResolvedChange[] {
  return applied.map((c) => {
    if (c.afterFp === undefined) throw new InventoryEditError('NOT_APPLIED', 'Only applied revisions can be rolled back');
    const restore = c.beforeItem;
    return {
      slot: c.slot,
      before: c.afterFp,
      beforeItem: null,
      after: restore ? { id: restore.id, amount: restore.amount, base: restore.fp, data: restore.data } : null,
    };
  });
}

/** Snapshot for dashboards: identical but without serialized data. */
export function publicItems(snapshot: Snapshot) {
  return snapshot.items.map(({ data: _data, ...item }) => item);
}
