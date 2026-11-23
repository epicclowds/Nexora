/**
 * Inventory editor model. The draft maps slots to desired items; `diff`
 * turns it into the backend's compare-and-set changes. Items that started
 * from an existing item keep a `base` fingerprint, and only fields that differ
 * from that item are sent, so untouched components (e.g. formatted names)
 * are preserved exactly.
 */
export interface InventoryItem {
  slot: number;
  id: string;
  amount: number;
  name?: string | null;
  lore?: string[];
  enchantments?: Record<string, number>;
  damage?: number;
  maxDamage?: number;
  fp: string;
}

export interface DraftItem {
  id: string;
  amount: number;
  name: string | null;
  lore: string[];
  enchantments: Record<string, number>;
  /** Fingerprint of the existing item this one is based on. */
  base?: string;
  damage?: number;
  maxDamage?: number;
}

/** slot → desired item; a slot missing from the map is unchanged, `null` means empty. */
export type Draft = Map<number, DraftItem | null>;

export interface Change {
  slot: number;
  before: string | null;
  after: { id: string; amount: number; base?: string; name?: string | null; lore?: string[]; enchantments?: Record<string, number> } | null;
}

export const ITEM_ID = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;

export function normalizeId(value: string): string {
  const v = value.trim().toLowerCase();
  return v.includes(':') ? v : `minecraft:${v}`;
}

export function toDraft(item: InventoryItem): DraftItem {
  return {
    id: item.id,
    amount: item.amount,
    name: item.name ?? null,
    lore: item.lore ?? [],
    enchantments: item.enchantments ?? {},
    base: item.fp,
    damage: item.damage,
    maxDamage: item.maxDamage,
  };
}

/** Current effective content of a slot (draft overrides snapshot). */
export function effective(items: Map<number, InventoryItem>, draft: Draft, slot: number): DraftItem | null {
  if (draft.has(slot)) return draft.get(slot) ?? null;
  const item = items.get(slot);
  return item ? toDraft(item) : null;
}

/** Moves (or swaps) the contents of two slots in the draft. */
export function move(items: Map<number, InventoryItem>, draft: Draft, from: number, to: number): Draft {
  if (from === to) return draft;
  const next = new Map(draft);
  const a = effective(items, draft, from);
  const b = effective(items, draft, to);
  next.set(to, a);
  next.set(from, b);
  return next;
}

/** Drops trailing empty lines (the editor keeps them while typing). */
export const cleanLore = (lore: string[]) => {
  const out = [...lore];
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out;
};

const sameLore = (a: string[], b: string[]) => a.length === b.length && a.every((l, i) => l === b[i]);
const sameEnchants = (a: Record<string, number>, b: Record<string, number>) =>
  Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, v]) => b[k] === v);

/** Compare-and-set changes for every slot whose content differs from the snapshot. */
export function diff(items: Map<number, InventoryItem>, draft: Draft, pool: InventoryItem[]): Change[] {
  const changes: Change[] = [];
  for (const [slot, desired] of draft) {
    const original = items.get(slot) ?? null;
    const before = original?.fp ?? null;
    if (!desired) {
      if (original) changes.push({ slot, before, after: null });
      continue;
    }
    const base = desired.base ? pool.find((i) => i.fp === desired.base) : undefined;
    const baseDraft = base ? toDraft(base) : undefined;
    const lore = cleanLore(desired.lore);
    const fieldsChanged = {
      name: !baseDraft || desired.name !== baseDraft.name,
      lore: !baseDraft || !sameLore(lore, baseDraft.lore),
      enchantments: !baseDraft || !sameEnchants(desired.enchantments, baseDraft.enchantments),
    };
    const unchanged = original && base && base.fp === original.fp && desired.amount === original.amount && !fieldsChanged.name && !fieldsChanged.lore && !fieldsChanged.enchantments;
    if (unchanged) continue;

    const after: NonNullable<Change['after']> = { id: desired.id, amount: desired.amount };
    if (base) after.base = base.fp;
    if (fieldsChanged.name && (base || desired.name)) after.name = desired.name || null;
    if (fieldsChanged.lore && (base || lore.length)) after.lore = lore;
    if (fieldsChanged.enchantments && (base || Object.keys(desired.enchantments).length)) after.enchantments = desired.enchantments;
    changes.push({ slot, before, after });
  }
  return changes.sort((a, b) => a.slot - b.slot);
}

/** Short label for item tiles: "diamond_sword" → "DS". */
export function initials(id: string): string {
  const words = id.replace(/^[^:]+:/, '').split('_').filter(Boolean);
  return (words.length > 1 ? words.slice(0, 2).map((w) => w[0]) : [words[0]?.slice(0, 2) ?? '?']).join('').toUpperCase();
}
