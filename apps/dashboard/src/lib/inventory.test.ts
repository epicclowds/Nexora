import { describe, expect, it } from 'vitest';
import { diff, type Draft, initials, type InventoryItem, move, normalizeId, toDraft } from './inventory';

const fp = (c: string) => c.repeat(64);
const sword: InventoryItem = { slot: 0, id: 'minecraft:diamond_sword', amount: 1, name: 'Excalibur', enchantments: { 'minecraft:sharpness': 5 }, fp: fp('a') };
const dirt: InventoryItem = { slot: 1, id: 'minecraft:dirt', amount: 64, fp: fp('b') };
const items = new Map([sword, dirt].map((i) => [i.slot, i]));
const pool = [sword, dirt];

describe('inventory draft', () => {
  it('produces no changes for an untouched draft', () => {
    const draft: Draft = new Map([[0, toDraft(sword)]]);
    expect(diff(items, draft, pool)).toEqual([]);
  });

  it('turns a move into two compare-and-set changes based on the original item', () => {
    const changes = diff(items, move(items, new Map(), 1, 5), pool);
    expect(changes).toEqual([
      { slot: 1, before: fp('b'), after: null },
      { slot: 5, before: null, after: { id: 'minecraft:dirt', amount: 64, base: fp('b') } },
    ]);
  });

  it('swaps occupied slots', () => {
    const changes = diff(items, move(items, new Map(), 0, 1), pool);
    expect(changes.map((c) => [c.slot, c.before, c.after?.base])).toEqual([
      [0, fp('a'), fp('b')],
      [1, fp('b'), fp('a')],
    ]);
  });

  it('only sends fields that differ from the base item', () => {
    const edited: Draft = new Map([[0, { ...toDraft(sword), amount: 1, name: 'Renamed' }]]);
    expect(diff(items, edited, pool)).toEqual([{ slot: 0, before: fp('a'), after: { id: 'minecraft:diamond_sword', amount: 1, base: fp('a'), name: 'Renamed' } }]);
    const unenchanted: Draft = new Map([[0, { ...toDraft(sword), enchantments: {} }]]);
    expect(diff(items, unenchanted, pool)[0].after).toEqual({ id: 'minecraft:diamond_sword', amount: 1, base: fp('a'), enchantments: {} });
  });

  it('ignores trailing empty lore lines left while typing', () => {
    const draft: Draft = new Map([[1, { ...toDraft(dirt), lore: ['Line', ''] }]]);
    expect(diff(items, draft, pool)[0].after?.lore).toEqual(['Line']);
    expect(diff(items, new Map([[1, { ...toDraft(dirt), lore: [''] }]]), pool)).toEqual([]);
  });

  it('creates new items without a base', () => {
    const draft: Draft = new Map([[9, { id: 'minecraft:golden_apple', amount: 3, name: null, lore: [], enchantments: {} }]]);
    expect(diff(items, draft, pool)).toEqual([{ slot: 9, before: null, after: { id: 'minecraft:golden_apple', amount: 3 } }]);
  });

  it('clears slots', () => {
    expect(diff(items, new Map([[0, null], [1, null], [2, null]]), pool)).toHaveLength(2);
  });

  it('normalises IDs and builds tile labels', () => {
    expect(normalizeId(' Diamond_Sword ')).toBe('minecraft:diamond_sword');
    expect(initials('minecraft:diamond_sword')).toBe('DS');
    expect(initials('minecraft:dirt')).toBe('DI');
  });
});
