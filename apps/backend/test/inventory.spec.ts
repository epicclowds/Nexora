import { describe, expect, it } from 'vitest';
import { editSchema, inverseChanges, InventoryEditError, publicItems, resolveEdit, type Snapshot } from '../src/inventory/inventory-model';

const fp = (c: string) => c.repeat(64);
const snapshot: Snapshot = {
  fp: fp('0'),
  items: [
    { slot: 0, id: 'minecraft:diamond_sword', amount: 1, name: 'Excalibur', enchantments: { 'minecraft:sharpness': 5 }, fp: fp('a'), data: 'U1dPUkQ=' },
    { slot: 1, id: 'minecraft:dirt', amount: 64, fp: fp('b'), data: 'RElSVA==' },
  ],
};
const enderChestItem = { slot: 0, id: 'minecraft:emerald', amount: 5, fp: fp('c'), data: 'RU1FUkFMRA==' };
const pool = [...snapshot.items, enderChestItem];

describe('resolveEdit', () => {
  it('resolves a move into two compare-and-set changes with server-side data', () => {
    const changes = resolveEdit('INVENTORY', snapshot, pool, {
      baseRevision: 1,
      changes: [
        { slot: 1, before: fp('b'), after: null },
        { slot: 5, before: null, after: { id: 'minecraft:dirt', amount: 64, base: fp('b') } },
      ],
    });
    expect(changes[0]).toMatchObject({ slot: 1, before: fp('b'), after: null, beforeItem: { id: 'minecraft:dirt' } });
    expect(changes[1].after).toMatchObject({ id: 'minecraft:dirt', amount: 64, data: 'RElSVA==' });
  });

  it('allows moving items from the ender chest', () => {
    const [change] = resolveEdit('INVENTORY', snapshot, pool, { baseRevision: 1, changes: [{ slot: 9, before: null, after: { id: 'minecraft:emerald', amount: 5, base: fp('c') } }] });
    expect(change.after?.data).toBe('RU1FUkFMRA==');
  });

  it('rejects stale slots, unknown or mismatched base items and invalid slots', () => {
    const run = (changes: Parameters<typeof resolveEdit>[3]['changes'], kind: 'INVENTORY' | 'ENDER_CHEST' = 'INVENTORY') => {
      try {
        resolveEdit(kind, snapshot, pool, { baseRevision: 1, changes });
        return 'ok';
      } catch (err) {
        return (err as InventoryEditError).code;
      }
    };
    expect(run([{ slot: 0, before: null, after: null }])).toBe('STALE_SLOT');
    expect(run([{ slot: 2, before: null, after: { id: 'minecraft:dirt', amount: 1, base: fp('f') } }])).toBe('UNKNOWN_BASE_ITEM');
    expect(run([{ slot: 2, before: null, after: { id: 'minecraft:stone', amount: 1, base: fp('b') } }])).toBe('BASE_TYPE_MISMATCH');
    expect(run([{ slot: 30, before: null, after: null }], 'ENDER_CHEST')).toBe('INVALID_SLOT');
  });

  it('never accepts raw item data from clients', () => {
    const parsed = editSchema.parse({ baseRevision: 1, changes: [{ slot: 3, before: null, after: { id: 'minecraft:stone', amount: 1, data: 'EVIL' } }] });
    expect(parsed.changes[0].after).not.toHaveProperty('data');
    expect(editSchema.safeParse({ baseRevision: 1, changes: [{ slot: 3, before: null, after: null }, { slot: 3, before: null, after: null }] }).success).toBe(false);
    expect(editSchema.safeParse({ baseRevision: 1, changes: [{ slot: 3, before: null, after: { id: 'minecraft:stone', amount: 1, enchantments: { 'minecraft:sharpness': 999 } } }] }).success).toBe(false);
  });
});

describe('inverseChanges', () => {
  it('restores the exact previous items and requires applied fingerprints', () => {
    const applied = resolveEdit('INVENTORY', snapshot, pool, { baseRevision: 1, changes: [{ slot: 0, before: fp('a'), after: { id: 'minecraft:diamond_sword', amount: 1, name: null, base: fp('a') } }] });
    expect(() => inverseChanges(applied)).toThrow(InventoryEditError);
    const inverse = inverseChanges(applied.map((c) => ({ ...c, afterFp: fp('d') })));
    expect(inverse[0]).toMatchObject({ slot: 0, before: fp('d'), after: { id: 'minecraft:diamond_sword', data: 'U1dPUkQ=' } });
  });
});

describe('publicItems', () => {
  it('strips serialized data before sending snapshots to browsers', () => {
    expect(publicItems(snapshot).every((i) => !('data' in i))).toBe(true);
  });
});
