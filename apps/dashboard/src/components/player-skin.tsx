'use client';

import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { canvasHeadRenderer, createHeadCache, type HeadSource, headUrl } from '@/lib/player-head';
import { cn } from '@/lib/utils';
import { PlayerAvatar } from './player-avatar';

/** Skins are served by the backend (cached, Mojang texture host only); no third-party request from the browser. */
export const skinUrl = (uuid: string) => `/api/players/${uuid}/skin`;

const heads = createHeadCache(canvasHeadRenderer);

/**
 * Player head (face plus hat layer) rendered from the player's skin, identified by UUID.
 * Renders are cached and shared across the page. While loading a neutral tile is
 * shown; a missing, invalid or unavailable skin falls back to a lettered avatar –
 * never a broken image.
 */
export function PlayerHead({
  uuid,
  username,
  size = 32,
  source,
  fallback,
  className,
}: {
  uuid: string;
  username: string;
  size?: number;
  /** Where the skin is loaded from; defaults to the player endpoint (players.view). */
  source?: HeadSource;
  /** Shown instead of the lettered player avatar when no skin is available. */
  fallback?: ReactNode;
  className?: string;
}) {
  const t = useTranslations('skin');
  const url = headUrl(source ?? { kind: 'player', uuid });
  const [image, setImage] = useState<string | null | undefined>(() => (url ? heads.peek(url) : null));

  useEffect(() => {
    if (!url) return setImage(null);
    let active = true;
    setImage(heads.peek(url));
    void heads.load(url).then((value) => {
      if (active) setImage(value);
    });
    return () => {
      active = false;
    };
  }, [url]);

  const box = { width: size, height: size };
  if (image === null) {
    if (fallback) return <span title={t('unavailable')} className="inline-flex shrink-0">{fallback}</span>;
    return (
      <span title={t('unavailable')} className="inline-flex shrink-0">
        <PlayerAvatar uuid={uuid} username={username} className={className} style={{ ...box, fontSize: Math.max(10, Math.round(size * 0.45)) }} />
      </span>
    );
  }
  if (image === undefined) return <span aria-hidden className={cn('inline-block shrink-0 animate-pulse rounded-md bg-muted', className)} style={box} />;
  // Data URL rendered locally from the cached skin.
  return <img src={image} alt="" aria-hidden width={size} height={size} draggable={false} className={cn('pixelated shrink-0 rounded-md bg-muted', className)} style={box} />;
}

/** Interactive 3D skin preview (skinview3d, loaded on demand). Drag to rotate. */
export function SkinViewer({ uuid, model, className }: { uuid: string; model: string | null; className?: string }) {
  const t = useTranslations('skin');
  const canvas = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');

  useEffect(() => {
    let disposed = false;
    let viewer: { dispose(): void } | null = null;
    void (async () => {
      const probe = await fetch(skinUrl(uuid), { method: 'GET', credentials: 'same-origin' }).catch(() => null);
      if (!probe?.ok || disposed || !canvas.current) {
        if (!disposed) setState('unavailable');
        return;
      }
      // Decode the image before handing it over, so the object URL can be revoked safely.
      const blobUrl = URL.createObjectURL(await probe.blob());
      const image = new Image();
      const decoded = await new Promise<boolean>((resolve) => {
        image.onload = () => resolve(true);
        image.onerror = () => resolve(false);
        image.src = blobUrl;
      });
      URL.revokeObjectURL(blobUrl);
      if (!decoded) {
        if (!disposed) setState('unavailable');
        return;
      }
      const { SkinViewer: Viewer, WalkingAnimation } = await import('skinview3d');
      if (disposed || !canvas.current) return;
      const instance = new Viewer({
        canvas: canvas.current,
        width: 220,
        height: 300,
        skin: image,
        model: model === 'slim' ? 'slim' : 'default',
        zoom: 0.85,
      });
      instance.autoRotate = true;
      instance.autoRotateSpeed = 0.6;
      const walk = new WalkingAnimation();
      walk.speed = 0.5;
      instance.animation = walk;
      instance.controls.enableZoom = false;
      viewer = instance;
      setState('ready');
    })();
    return () => {
      disposed = true;
      viewer?.dispose();
    };
  }, [uuid, model]);

  return (
    <div className={cn('relative flex h-[300px] w-[220px] items-center justify-center', className)}>
      <canvas ref={canvas} className={cn('cursor-grab active:cursor-grabbing', state !== 'ready' && 'invisible')} aria-label={t('preview')} title={t('dragHint')} />
      {state === 'loading' && <div className="absolute inset-8 animate-pulse rounded-xl bg-muted" />}
      {state === 'unavailable' && <p className="absolute text-xs text-muted-foreground">{t('unavailable')}</p>}
    </div>
  );
}
