'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { PlayerAvatar } from './player-avatar';

/** Skins are served by the backend (cached, Mojang texture host only); no third-party request from the browser. */
export const skinUrl = (uuid: string) => `/api/players/${uuid}/skin`;

/**
 * Player head rendered from the skin texture: face (8×8 at 8,8) plus the hat
 * overlay (8×8 at 40,8), pixel-perfect. Falls back to a lettered avatar.
 */
export function PlayerHead({ uuid, username, size = 32, className }: { uuid: string; username: string; size?: number; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    const img = new Image();
    img.onload = () => {
      const ctx = canvas.current?.getContext('2d');
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, 8, 8);
      ctx.drawImage(img, 8, 8, 8, 8, 0, 0, 8, 8);
      ctx.drawImage(img, 40, 8, 8, 8, 0, 0, 8, 8);
    };
    img.onerror = () => setFailed(true);
    img.src = skinUrl(uuid);
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [uuid]);

  if (failed) return <PlayerAvatar uuid={uuid} username={username} className={className} />;
  return (
    <canvas
      ref={canvas}
      width={8}
      height={8}
      aria-hidden
      className={cn('pixelated shrink-0 rounded-md bg-muted', className)}
      style={{ width: size, height: size }}
    />
  );
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
      const blobUrl = URL.createObjectURL(await probe.blob());
      const { SkinViewer: Viewer, WalkingAnimation } = await import('skinview3d');
      if (disposed || !canvas.current) return;
      const instance = new Viewer({
        canvas: canvas.current,
        width: 220,
        height: 300,
        skin: blobUrl,
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
      URL.revokeObjectURL(blobUrl);
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
