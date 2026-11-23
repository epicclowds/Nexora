'use client';

import { Gavel, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/app-shell';
import { PunishDialog, useIssuableTypes } from '@/components/punishment-dialogs';
import { PunishmentTable } from '@/components/punishment-table';
import { useLiveRefresh } from '@/components/realtime-provider';
import { Alert, Button, Card, Input, Select, Skeleton } from '@/components/ui/primitives';
import { api, errorKey, type Page, type Punishment, type PunishmentType } from '@/lib/api';

const PAGE_SIZE = 25;
const TYPES: PunishmentType[] = ['BAN', 'TEMP_BAN', 'BLACKLIST', 'MUTE', 'TEMP_MUTE', 'KICK', 'WARNING'];

export default function ModerationPage() {
  const t = useTranslations();
  const issuable = useIssuableTypes();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [type, setType] = useState<PunishmentType | ''>('');
  const [status, setStatus] = useState<'active' | 'expired' | 'revoked' | ''>('active');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<Punishment> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (search) params.set('search', search);
    if (type) params.set('type', type);
    if (status) params.set('status', status);
    try {
      setData(await api<Page<Punishment>>(`/punishments?${params}`));
      setError(null);
    } catch (err) {
      setError(t(`errors.${errorKey(err)}`));
    }
  }, [page, search, type, status, t]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const id = setTimeout(() => {
      setPage(1);
      setSearch(query.trim());
    }, 300);
    return () => clearTimeout(id);
  }, [query]);
  useLiveRefresh(['punishment.changed'], load);

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <>
      <PageHeader
        title={t('moderation.title')}
        subtitle={t('moderation.subtitle')}
        actions={
          issuable.length > 0 && (
            <PunishDialog
              onIssued={load}
              trigger={
                <Button>
                  <Gavel aria-hidden /> {t('moderation.newPunishment')}
                </Button>
              }
            />
          )
        }
      />
      <div className="mb-4 flex flex-wrap gap-3">
        <label className="relative min-w-64 flex-1">
          <span className="sr-only">{t('moderation.search')}</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input className="pl-9" placeholder={t('moderation.search')} value={query} onChange={(e) => setQuery(e.target.value)} maxLength={64} />
        </label>
        <Select aria-label={t('moderation.type')} className="w-48" value={type} onChange={(e) => { setPage(1); setType(e.target.value as PunishmentType | ''); }}>
          <option value="">{t('moderation.allTypes')}</option>
          {TYPES.map((ty) => (
            <option key={ty} value={ty}>
              {t(`moderation.types.${ty}`)}
            </option>
          ))}
        </Select>
        <Select aria-label={t('moderation.status')} className="w-44" value={status} onChange={(e) => { setPage(1); setStatus(e.target.value as typeof status); }}>
          <option value="">{t('moderation.allStatuses')}</option>
          <option value="active">{t('moderation.filter.active')}</option>
          <option value="expired">{t('moderation.filter.expired')}</option>
          <option value="revoked">{t('moderation.filter.revoked')}</option>
        </Select>
      </div>
      {error && <Alert variant="destructive" className="mb-4">{error}</Alert>}
      <Card>
        {!data ? (
          <div className="grid gap-2 p-5">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : data.items.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">{t('moderation.empty')}</p>
        ) : (
          <PunishmentTable items={data.items} showTarget onChange={load} />
        )}
      </Card>
      {data && pages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-3 text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            {t('common.previous')}
          </Button>
          <span className="text-muted-foreground">{t('common.page', { page, pages })}</span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            {t('common.next')}
          </Button>
        </div>
      )}
    </>
  );
}
