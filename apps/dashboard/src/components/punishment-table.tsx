'use client';

import { PERMISSIONS } from '@mnm/shared-types';
import { Paperclip } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import type { Punishment, PunishmentType } from '@/lib/api';
import { useAuth } from './auth-provider';
import { RevokeDialog } from './punishment-dialogs';
import { Badge } from './ui/primitives';
import { TBody, TD, TH, THead, TR, Table } from './ui/table';

const REVOKE_PERMISSION: Record<PunishmentType, string> = {
  BAN: PERMISSIONS.PUNISHMENTS_UNBAN,
  TEMP_BAN: PERMISSIONS.PUNISHMENTS_UNBAN,
  BLACKLIST: PERMISSIONS.PUNISHMENTS_BLACKLIST,
  MUTE: PERMISSIONS.PUNISHMENTS_UNMUTE,
  TEMP_MUTE: PERMISSIONS.PUNISHMENTS_UNMUTE,
  WARNING: PERMISSIONS.PUNISHMENTS_WARN,
  KICK: PERMISSIONS.PUNISHMENTS_KICK,
};

function typeVariant(type: PunishmentType) {
  if (type === 'BAN' || type === 'TEMP_BAN' || type === 'BLACKLIST') return 'danger' as const;
  if (type === 'MUTE' || type === 'TEMP_MUTE') return 'warning' as const;
  return 'info' as const;
}

export function PunishmentTable({ items, showTarget, onChange }: { items: Punishment[]; showTarget: boolean; onChange: () => void }) {
  const t = useTranslations();
  const format = useFormatter();
  const now = useNow({ updateInterval: 30_000 });
  const { can } = useAuth();
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <Table>
      <THead>
        <TR>
          <TH>{t('moderation.type')}</TH>
          {showTarget && <TH>{t('moderation.target')}</TH>}
          <TH>{t('moderation.reason')}</TH>
          <TH>{t('moderation.issuer')}</TH>
          <TH>{t('moderation.created')}</TH>
          <TH>{t('moderation.expires')}</TH>
          <TH>{t('moderation.status')}</TH>
          <TH className="text-right">
            <span className="sr-only">{t('common.actions')}</span>
          </TH>
        </TR>
      </THead>
      <TBody>
        {items.map((p) => (
          <TR key={p.id}>
            <TD>
              <Badge variant={typeVariant(p.type)} className="whitespace-nowrap">{t(`moderation.types.${p.type}`)}</Badge>
            </TD>
            {showTarget && (
              <TD>
                <Link href={`/players/${p.target.uuid}`} className="font-medium hover:underline">
                  {p.target.username}
                </Link>
              </TD>
            )}
            <TD className="min-w-48 max-w-80">
              <span className="line-clamp-2">{p.reason}</span>
              {p.preset && <span className="text-[10px] text-muted-foreground">{t('reasons.reference', { category: t(`reasons.categories.${p.preset.category}`), id: p.preset.numericId })}</span>}
              <span className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <Link href={`/moderation/${p.id}`} className="font-mono hover:text-foreground hover:underline" title={t('punishment.open')}>
                  #{p.id}
                </Link>
                {p.evidenceCount > 0 && (
                  <span className="inline-flex items-center gap-0.5" title={t('punishment.evidenceCount', { count: p.evidenceCount })}>
                    <Paperclip aria-hidden className="size-3" />
                    {p.evidenceCount}
                  </span>
                )}
              </span>
            </TD>
            <TD className="whitespace-nowrap">
              {p.issuer.name}
              <span className="block text-xs text-muted-foreground">
                {t(`moderation.sources.${p.source}`)}
                {p.server ? ` · ${p.server.name}` : ''}
              </span>
            </TD>
            <TD className="whitespace-nowrap text-muted-foreground">{date(p.createdAt)}</TD>
            <TD className="whitespace-nowrap text-muted-foreground">
              {p.type === 'KICK' || p.type === 'WARNING' ? '–' : p.expiresAt ? (p.status === 'ACTIVE' ? format.relativeTime(new Date(p.expiresAt), now) : date(p.expiresAt)) : t('moderation.permanent')}
            </TD>
            <TD>
              <Badge variant={p.status === 'ACTIVE' ? 'default' : 'muted'} className="whitespace-nowrap">{t(`moderation.statuses.${p.status}`)}</Badge>
              {p.revokedBy && <span className="block text-xs text-muted-foreground">{t('moderation.revokedBy', { name: p.revokedBy })}</span>}
            </TD>
            <TD className="text-right">
              <span className="inline-flex items-center gap-1">
                <Link href={`/moderation/${p.id}`} className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
                  {t('punishment.details')}
                </Link>
                {p.revocable && can(REVOKE_PERMISSION[p.type]) && <RevokeDialog punishment={p} onRevoked={onChange} />}
              </span>
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
