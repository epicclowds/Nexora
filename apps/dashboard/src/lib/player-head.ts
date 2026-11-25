/**
 * Player head images, rendered from skin textures served by the Nexora backend
 * (which resolves skins by UUID and caches them; the browser never contacts a
 * third-party skin service).
 *
 * Rendered heads are cached in memory per texture URL, so a head that appears in
 * the sidebar, a table and a dialog is downloaded and drawn once. Failures are
 * cached for a shorter time to avoid hammering an unavailable skin service.
 */

const UUID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

/** Successful renders are reused for an hour (matches the backend's Cache-Control). */
export const HEAD_TTL_MS = 60 * 60_000;
/** Missing or invalid skins are retried after five minutes. */
export const HEAD_FAILURE_TTL_MS = 5 * 60_000;

export type HeadSource =
  /** Any known player (needs players.view). */
  | { kind: 'player'; uuid: string }
  /** The signed-in user's linked account (no extra permission). */
  | { kind: 'self'; uuid: string }
  /** A dashboard account's linked player (User Management, users.view). */
  | { kind: 'user'; userId: string; uuid: string };

export function isMinecraftUuid(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/**
 * Backend URL of the skin texture for a head, or null when the UUID is invalid.
 * Skins are always identified by UUID; the UUID is part of every URL so that a
 * relinked account never shows a cached head of the previous player.
 */
export function headUrl(source: HeadSource): string | null {
  if (!isMinecraftUuid(source.uuid)) return null;
  const uuid = source.uuid.toLowerCase();
  switch (source.kind) {
    case 'player':
      return `/api/players/${uuid}/skin`;
    case 'self':
      return `/api/account/minecraft-link/skin?uuid=${uuid}`;
    case 'user':
      return `/api/users/${encodeURIComponent(source.userId)}/minecraft-link/skin?uuid=${uuid}`;
  }
}

/** Turns a texture URL into a displayable head image (data URL); rejects when unavailable or invalid. */
export type HeadRenderer = (url: string) => Promise<string>;

interface Entry {
  promise: Promise<string | null>;
  /** Settled value; undefined while loading. */
  value?: string | null;
  expiresAt: number;
}

export function createHeadCache(render: HeadRenderer, now: () => number = Date.now) {
  const entries = new Map<string, Entry>();
  const fresh = (entry: Entry | undefined): entry is Entry => !!entry && entry.expiresAt > now();
  return {
    /** Resolves to the head image, or null when the skin is unavailable. Never rejects; concurrent calls share one request. */
    load(url: string): Promise<string | null> {
      const hit = entries.get(url);
      if (fresh(hit)) return hit.promise;
      const entry: Entry = { promise: Promise.resolve(null), expiresAt: Number.POSITIVE_INFINITY };
      const settle = (value: string | null, ttl: number) => {
        entry.value = value;
        entry.expiresAt = now() + ttl;
        return value;
      };
      entry.promise = render(url).then(
        (image) => settle(image, HEAD_TTL_MS),
        () => settle(null, HEAD_FAILURE_TTL_MS),
      );
      entries.set(url, entry);
      return entry.promise;
    },
    /** Finished render for a URL (avoids a loading flash on remount); undefined when not loaded yet. */
    peek(url: string): string | null | undefined {
      const hit = entries.get(url);
      return fresh(hit) ? hit.value : undefined;
    },
    clear() {
      entries.clear();
    },
  };
}

/** A skin texture is 64×64 (or legacy 64×32); anything else is not a valid skin. */
export function isSkinSize(width: number, height: number): boolean {
  return width === 64 && (height === 64 || height === 32);
}

/** Browser renderer: face (8×8 at 8,8) plus the hat layer (8×8 at 40,8), scaled up pixel-perfect. */
export const canvasHeadRenderer: HeadRenderer = (url) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (!isSkinSize(img.naturalWidth, img.naturalHeight)) return reject(new Error('invalid skin'));
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('no canvas'));
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 8, 8, 8, 8, 0, 0, 64, 64);
      ctx.drawImage(img, 40, 8, 8, 8, 0, 0, 64, 64);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('skin unavailable'));
    img.src = url;
  });
