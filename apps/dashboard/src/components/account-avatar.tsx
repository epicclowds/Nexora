'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { useAuth } from '@/components/auth-provider';
import { PlayerHead } from '@/components/player-skin';
import type { MinecraftRank } from '@/lib/rank';
import { api } from '@/lib/api';
import { isMinecraftUuid } from '@/lib/player-head';
import { cn } from '@/lib/utils';

export interface MinecraftLinkInfo {
  minecraftUuid: string;
  minecraftUsername: string;
  linkedAt: string;
  lastVerifiedAt?: string | null;
}

export interface OwnMinecraftLink {
  linkingEnabled: boolean;
  link: MinecraftLinkInfo | null;
  rank: MinecraftRank | null;
}

// ── the signed-in user's link, shared by the sidebar and Settings ──────────

let store: { userId: string; state: OwnMinecraftLink | null } | null = null;
let inflight: { userId: string; promise: Promise<void> } | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Reloads the signed-in user's Minecraft link (e.g. after linking) and updates every consumer. */
export function refreshOwnMinecraftLink(userId: string): Promise<void> {
  if (inflight?.userId === userId) return inflight.promise;
  const promise = api<OwnMinecraftLink>('/account/minecraft-link')
    .then((state) => {
      store = { userId, state };
    })
    .catch(() => {
      // Keep what we had; without data the default avatar is shown.
      if (store?.userId !== userId) store = { userId, state: null };
    })
    .finally(() => {
      inflight = null;
      notify();
    });
  inflight = { userId, promise };
  return promise;
}

/** undefined while loading, null when unavailable. */
export function useOwnMinecraftLink(): OwnMinecraftLink | null | undefined {
  const { user } = useAuth();
  const snapshot = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => (store?.userId === user.id ? store.state : undefined),
    () => undefined,
  );
  useEffect(() => {
    if (store?.userId !== user.id) void refreshOwnMinecraftLink(user.id);
  }, [user.id]);
  return snapshot;
}

// ── avatars ────────────────────────────────────────────────────────────────

/** Default Nexora avatar: the account's initial. */
export function DefaultAvatar({ username, size = 36, className }: { username: string; size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-flex shrink-0 select-none items-center justify-center rounded-md bg-primary/15 font-semibold text-primary outline outline-1 -outline-offset-1 outline-primary/20', className)}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.42)) }}
    >
      {username.slice(0, 1).toUpperCase()}
    </span>
  );
}

/**
 * Avatar of a dashboard account. Priority: the linked Minecraft account's head
 * (resolved by UUID) → the default Nexora avatar. Nexora has no uploaded avatars,
 * so there is no custom-avatar step. `userId` selects the User Management
 * endpoint; without it the signed-in user's own avatar is loaded.
 */
export function AccountAvatar({
  username,
  minecraftUuid,
  minecraftUsername,
  userId,
  size = 36,
  className,
}: {
  username: string;
  minecraftUuid?: string | null;
  minecraftUsername?: string | null;
  userId?: string;
  size?: number;
  className?: string;
}) {
  const fallback = <DefaultAvatar username={username} size={size} className={className} />;
  if (!isMinecraftUuid(minecraftUuid)) return fallback;
  return (
    <PlayerHead
      uuid={minecraftUuid}
      username={minecraftUsername ?? username}
      size={size}
      source={userId ? { kind: 'user', userId, uuid: minecraftUuid } : { kind: 'self', uuid: minecraftUuid }}
      fallback={fallback}
      className={cn('outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10', className)}
    />
  );
}
