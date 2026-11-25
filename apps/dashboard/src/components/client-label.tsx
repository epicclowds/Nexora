'use client';

import { isKnownClient, KNOWN_CLIENTS, type KnownClient } from '@mnm/shared-types';
import { useFormatter, useTranslations } from 'next-intl';
import type { ClientInfo } from '@/lib/api';
import { cn } from '@/lib/utils';

/** Monogram colours per client (decorative; the name is always shown as text). */
const MONOGRAM: Record<KnownClient, { letter: string; color: string }> = {
  vanilla: { letter: 'V', color: '#5B8731' },
  fabric: { letter: 'F', color: '#9C8B6E' },
  quilt: { letter: 'Q', color: '#7B4FBF' },
  forge: { letter: 'F', color: '#3F4D68' },
  neoforge: { letter: 'N', color: '#D7742F' },
  norisk: { letter: 'N', color: '#C0392B' },
  lunar: { letter: 'L', color: '#2C6BED' },
  badlion: { letter: 'B', color: '#D35400' },
  feather: { letter: 'F', color: '#1E88E5' },
  labymod: { letter: 'L', color: '#0F9D58' },
};

/** Display name of a client key, or the translated "Unknown". */
export function useClientName() {
  const t = useTranslations();
  return (name: string | null | undefined) => (isKnownClient(name) ? KNOWN_CLIENTS[name] : t('clients.unknown'));
}

/**
 * Detected client of a connection. Only names a client when there is evidence
 * (reported brand or a client integration); otherwise "Unknown". With
 * `details`, also the raw reported brand (when the viewer may see it), how it
 * was detected and when.
 */
export function ClientLabel({ client, details = false, className }: { client: ClientInfo | null | undefined; details?: boolean; className?: string }) {
  const t = useTranslations();
  const format = useFormatter();
  const clientName = useClientName();
  const known = client && isKnownClient(client.name) ? client.name : null;
  const monogram = known ? MONOGRAM[known] : null;
  const brand = client?.brand?.trim() || null;
  return (
    <span className={cn('inline-flex min-w-0 flex-col', className)}>
      <span className="inline-flex items-center gap-1.5">
        {monogram ? (
          <span aria-hidden className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-[10px] font-bold text-white" style={{ backgroundColor: monogram.color }}>
            {monogram.letter}
          </span>
        ) : (
          <span aria-hidden className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm border text-[10px] text-muted-foreground">
            ?
          </span>
        )}
        <span className={cn(!known && 'text-muted-foreground')}>{clientName(known)}</span>
      </span>
      {details && client && (
        <>
          {brand && (
            <span className="text-muted-foreground" title={t('clients.rawBrandHint')}>
              {t('clients.rawBrand')}: <span className="font-mono">{brand}</span>
            </span>
          )}
          {client.source && (
            <span className="text-muted-foreground">
              {t(`clients.source.${client.source}`)}
              {client.detectedAt && <> · {format.dateTime(new Date(client.detectedAt), { timeStyle: 'short' })}</>}
            </span>
          )}
        </>
      )}
    </span>
  );
}
