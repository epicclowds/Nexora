import { describe, expect, it, vi } from 'vitest';
import { createHeadCache, HEAD_FAILURE_TTL_MS, HEAD_TTL_MS, headUrl, isMinecraftUuid, isSkinSize } from './player-head';

const UUID = '069a79f4-44e9-4726-a5be-fca90e38aaf5';

describe('headUrl (UUID-based skin resolution)', () => {
  it('builds backend URLs from the UUID, never from a username', () => {
    expect(headUrl({ kind: 'player', uuid: UUID })).toBe(`/api/players/${UUID}/skin`);
    expect(headUrl({ kind: 'self', uuid: UUID.toUpperCase() })).toBe(`/api/account/minecraft-link/skin?uuid=${UUID}`);
    expect(headUrl({ kind: 'user', userId: 'clx 1/2', uuid: UUID })).toBe(`/api/users/clx%201%2F2/minecraft-link/skin?uuid=${UUID}`);
  });

  it('rejects anything that is not a UUID (unlinked accounts, usernames)', () => {
    expect(headUrl({ kind: 'self', uuid: 'Notch' })).toBeNull();
    expect(headUrl({ kind: 'player', uuid: '' })).toBeNull();
    expect(isMinecraftUuid(null)).toBe(false);
    expect(isMinecraftUuid(undefined)).toBe(false);
    expect(isMinecraftUuid(UUID.replace(/-/g, ''))).toBe(true);
  });

  it('changes the URL when an account is relinked to another player', () => {
    const other = '853c80ef-3c37-49fd-aa49-938b674adae6';
    expect(headUrl({ kind: 'self', uuid: UUID })).not.toBe(headUrl({ kind: 'self', uuid: other }));
  });
});

describe('createHeadCache', () => {
  it('renders each skin once and shares concurrent requests', async () => {
    const render = vi.fn(async (url: string) => `data:${url}`);
    const cache = createHeadCache(render);
    const [a, b] = await Promise.all([cache.load('/a'), cache.load('/a')]);
    expect(a).toBe('data:/a');
    expect(b).toBe('data:/a');
    expect(await cache.load('/a')).toBe('data:/a');
    expect(render).toHaveBeenCalledTimes(1);
    expect(cache.peek('/a')).toBe('data:/a');
    expect(cache.peek('/b')).toBeUndefined();
  });

  it('expires successful renders after the cache period', async () => {
    let now = 0;
    const render = vi.fn(async () => 'img');
    const cache = createHeadCache(render, () => now);
    await cache.load('/a');
    now = HEAD_TTL_MS - 1;
    await cache.load('/a');
    expect(render).toHaveBeenCalledTimes(1);
    now = HEAD_TTL_MS + 1;
    expect(cache.peek('/a')).toBeUndefined();
    await cache.load('/a');
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('turns missing or invalid skins into null and retries only after the failure period', async () => {
    let now = 0;
    const render = vi.fn(async () => {
      throw new Error('skin unavailable');
    });
    const cache = createHeadCache(render, () => now);
    expect(await cache.load('/missing')).toBeNull();
    expect(cache.peek('/missing')).toBeNull();
    now = HEAD_FAILURE_TTL_MS - 1;
    expect(await cache.load('/missing')).toBeNull();
    expect(render).toHaveBeenCalledTimes(1);
    now = HEAD_FAILURE_TTL_MS + 1;
    await cache.load('/missing');
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('reports nothing while a render is still loading', () => {
    const cache = createHeadCache(() => new Promise(() => undefined));
    void cache.load('/slow');
    expect(cache.peek('/slow')).toBeUndefined();
  });
});

describe('isSkinSize', () => {
  it('accepts 64×64 and legacy 64×32 textures only', () => {
    expect(isSkinSize(64, 64)).toBe(true);
    expect(isSkinSize(64, 32)).toBe(true);
    expect(isSkinSize(128, 128)).toBe(false);
    expect(isSkinSize(1, 1)).toBe(false);
  });
});
