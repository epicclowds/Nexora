'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/app-shell';
import { Alert, Badge, Button, Card, Input, Skeleton } from '@/components/ui/primitives';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { api, type AuditEntry, errorKey, type Page } from '@/lib/api';

const PAGE_SIZE = 25;

export default function AuditPage() {
  const t = useTranslations();
  const format = useFormatter();
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [filter, setFilter] = useState('');
  const [data, setData] = useState<Page<AuditEntry> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (filter) params.set('action', filter);
    try {
      setData(await api<Page<AuditEntry>>(`/audit-logs?${params}`));
      setError(null);
    } catch (err) {
      setError(t(`errors.${errorKey(err)}`));
    }
  }, [page, filter, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = setTimeout(() => {
      setPage(1);
      setFilter(action.trim());
    }, 300);
    return () => clearTimeout(id);
  }, [action]);

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <>
      <PageHeader
        title={t('audit.title')}
        subtitle={t('audit.subtitle')}
        actions={<Input className="w-72" placeholder={t('audit.filterAction')} aria-label={t('audit.filterAction')} value={action} onChange={(e) => setAction(e.target.value)} />}
      />
      {error && <Alert variant="destructive">{error}</Alert>}
      <Card>
        {!data ? (
          <div className="grid gap-2 p-5">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        ) : data.items.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">{t('audit.empty')}</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>{t('audit.timestamp')}</TH>
                <TH>{t('audit.actor')}</TH>
                <TH>{t('audit.action')}</TH>
                <TH>{t('audit.target')}</TH>
              </TR>
            </THead>
            <TBody>
              {data.items.map((e) => (
                <TR key={e.id}>
                  <TD className="whitespace-nowrap text-muted-foreground">
                    <time dateTime={e.createdAt}>{format.dateTime(new Date(e.createdAt), { dateStyle: 'medium', timeStyle: 'medium' })}</time>
                  </TD>
                  <TD>
                    <span className="font-medium">{e.actorType === 'SYSTEM' ? t('audit.system') : e.actorName}</span>{' '}
                    <Badge variant="muted">{e.actorType}</Badge>
                  </TD>
                  <TD className="font-mono text-xs">{e.action}</TD>
                  <TD className="font-mono text-xs text-muted-foreground">{e.targetType ? `${e.targetType}:${e.targetId ?? ''}` : '–'}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
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
