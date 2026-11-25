'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Toggle } from '@/components/minecraft-integration';
import { useToast } from '@/components/toaster';
import { Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from '@/components/ui/primitives';
import { api, errorKey } from '@/lib/api';

export interface ClientDetectionSettingsValue {
  enabled: boolean;
  debug: boolean;
  norisk: boolean;
  showRawBrand: boolean;
}

/** Settings → Minecraft integration → Client detection (applied by the proxy within one heartbeat). */
export function ClientDetectionSettings() {
  const t = useTranslations();
  const toast = useToast();
  const [saved, setSaved] = useState<ClientDetectionSettingsValue | null>(null);
  const [draft, setDraft] = useState<ClientDetectionSettingsValue | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<ClientDetectionSettingsValue>('/settings/client-detection')
      .then((value) => {
        setSaved(value);
        setDraft(value);
      })
      .catch((err) => setError(t(`errors.${errorKey(err)}`)));
  }, [t]);

  if (error) return <Alert variant="destructive">{error}</Alert>;
  if (!draft || !saved) return <Skeleton className="h-40" />;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const set = (patch: Partial<ClientDetectionSettingsValue>) => setDraft({ ...draft, ...patch });

  async function save() {
    if (!draft) return;
    try {
      const value = await api<ClientDetectionSettingsValue>('/settings/client-detection', { method: 'PUT', body: draft });
      setSaved(value);
      setDraft(value);
      toast(t('settings.saved'));
    } catch (err) {
      toast(t(`errors.${errorKey(err)}`), 'error');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('clientDetection.title')}</CardTitle>
        <CardDescription>{t('clientDetection.description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Toggle label={t('clientDetection.enabled')} hint={t('clientDetection.enabledHint')} checked={draft.enabled} onChange={(enabled) => set({ enabled })} />
        <Toggle label={t('clientDetection.norisk')} hint={t('clientDetection.noriskHint')} checked={draft.norisk} disabled={!draft.enabled} onChange={(norisk) => set({ norisk })} />
        <Toggle label={t('clientDetection.showRawBrand')} hint={t('clientDetection.showRawBrandHint')} checked={draft.showRawBrand} onChange={(showRawBrand) => set({ showRawBrand })} />
        <Toggle label={t('clientDetection.debug')} hint={t('clientDetection.debugHint')} checked={draft.debug} disabled={!draft.enabled} onChange={(debug) => set({ debug })} />
        <Alert>{t('clientDetection.selfReported')}</Alert>
        <div className="flex justify-end">
          <Button disabled={!dirty} onClick={() => void save()}>
            {t('common.save')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
