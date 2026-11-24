'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { splitDuration, TEMPORARY_TYPES, UNIT_SECONDS, type Unit } from '@/components/punishment-dialogs';
import { useToast } from '@/components/toaster';
import { Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { Switch } from '@/components/ui/switch';
import { api, errorKey, type ModerationPreset, type PunishmentType } from '@/lib/api';

const TYPES: PunishmentType[] = ['WARNING', 'KICK', 'TEMP_MUTE', 'MUTE', 'TEMP_BAN', 'BAN', 'BLACKLIST'];
const EXAMPLES: Omit<ModerationPreset, 'id'>[] = [
  { name: 'Spam', type: 'TEMP_MUTE', reason: 'Spamming in chat', durationSeconds: 3600 },
  { name: 'Insults', type: 'TEMP_MUTE', reason: 'Insulting other players', durationSeconds: 86_400 },
  { name: 'Griefing', type: 'TEMP_BAN', reason: 'Griefing', durationSeconds: 7 * 86_400 },
  { name: 'Cheating', type: 'TEMP_BAN', reason: 'Use of unfair modifications', durationSeconds: 30 * 86_400 },
];

const slug = (name: string, taken: Set<string>) => {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'preset';
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
  return id;
};

/** Settings → Moderation: punishment templates (reason, type, duration) offered in the punishment dialog. */
export function ModerationPresets() {
  const t = useTranslations();
  const toast = useToast();
  const [presets, setPresets] = useState<ModerationPreset[] | null>(null);
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  const [requireEvidence, setRequireEvidence] = useState(false);

  useEffect(() => {
    api<{ presets: ModerationPreset[]; requireEvidence?: boolean }>('/settings/moderation')
      .then((m) => {
        setPresets(m.presets);
        setRequireEvidence(m.requireEvidence ?? false);
        setSaved(JSON.stringify(m.presets));
      })
      .catch(() => undefined);
  }, []);

  if (!presets) return null;
  const update = (index: number, patch: Partial<ModerationPreset>) => setPresets(presets.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  const invalid = presets.some((p) => !p.name.trim() || !p.reason.trim() || (TEMPORARY_TYPES.includes(p.type) && !(p.durationSeconds && p.durationSeconds >= 60)));

  function add(example?: Omit<ModerationPreset, 'id'>) {
    if (!presets) return;
    const base = example ?? { name: '', type: 'WARNING' as const, reason: '', durationSeconds: null };
    setPresets([...presets, { ...base, id: slug(base.name || `preset-${presets.length + 1}`, new Set(presets.map((p) => p.id))) }]);
  }

  async function save() {
    if (!presets) return;
    setBusy(true);
    try {
      const body = { presets: presets.map((p) => ({ ...p, name: p.name.trim(), reason: p.reason.trim() })), requireEvidence };
      const result = await api<{ presets: ModerationPreset[] }>('/settings/moderation', { method: 'PUT', body });
      setPresets(result.presets);
      setSaved(JSON.stringify(result.presets));
      toast(t('settings.saved'));
    } catch (err) {
      toast(t(`errors.${errorKey(err)}`), 'error');
    } finally {
      setBusy(false);
    }
  }

  /** The evidence policy saves on its own, together with the last saved presets. */
  async function savePolicy(next: boolean) {
    setRequireEvidence(next);
    try {
      await api('/settings/moderation', { method: 'PUT', body: { presets: JSON.parse(saved) as ModerationPreset[], requireEvidence: next } });
      toast(t('settings.saved'));
    } catch (err) {
      setRequireEvidence(!next);
      toast(t(`errors.${errorKey(err)}`), 'error');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('presets.title')}</CardTitle>
        <CardDescription>{t('presets.description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
          <div className="grid gap-1">
            <span className="text-sm font-medium">{t('presets.requireEvidence')}</span>
            <span className="text-xs text-muted-foreground">{t('presets.requireEvidenceHint')}</span>
          </div>
          <Switch aria-label={t('presets.requireEvidence')} checked={requireEvidence} onCheckedChange={(v) => void savePolicy(v)} />
        </div>
        {presets.length === 0 && (
          <Alert className="flex flex-wrap items-center justify-between gap-2">
            {t('presets.empty')}
            <Button size="sm" variant="outline" onClick={() => setPresets(EXAMPLES.map((e) => ({ ...e, id: slug(e.name, new Set()) })))}>
              {t('presets.insertExamples')}
            </Button>
          </Alert>
        )}
        <ul className="grid gap-3">
          {presets.map((p, i) => {
            const temporary = TEMPORARY_TYPES.includes(p.type);
            const split = splitDuration(p.durationSeconds ?? 86_400);
            return (
              <li key={p.id} className="grid gap-3 rounded-lg border p-4">
                <div className="grid gap-3 sm:grid-cols-[1fr_180px_220px_auto] sm:items-end">
                  <Field label={t('presets.name')} htmlFor={`pr-name-${i}`}>
                    <Input id={`pr-name-${i}`} value={p.name} maxLength={64} onChange={(e) => update(i, { name: e.target.value })} />
                  </Field>
                  <Field label={t('moderation.type')} htmlFor={`pr-type-${i}`}>
                    <Select
                      id={`pr-type-${i}`}
                      value={p.type}
                      onChange={(e) => {
                        const type = e.target.value as PunishmentType;
                        update(i, { type, durationSeconds: TEMPORARY_TYPES.includes(type) ? (p.durationSeconds ?? 86_400) : null });
                      }}
                    >
                      {TYPES.map((ty) => (
                        <option key={ty} value={ty}>
                          {t(`moderation.types.${ty}`)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {temporary ? (
                    <Field label={t('moderation.duration')} htmlFor={`pr-amount-${i}`}>
                      <div className="grid grid-cols-2 gap-2">
                        <Input id={`pr-amount-${i}`} type="number" min={1} max={5000} value={split.amount} onChange={(e) => update(i, { durationSeconds: Math.max(1, e.target.valueAsNumber || 1) * UNIT_SECONDS[split.unit] })} />
                        <Select aria-label={t('moderation.unit')} value={split.unit} onChange={(e) => update(i, { durationSeconds: split.amount * UNIT_SECONDS[e.target.value as Unit] })}>
                          {(Object.keys(UNIT_SECONDS) as Unit[]).map((u) => (
                            <option key={u} value={u}>
                              {t(`moderation.units.${u}`)}
                            </option>
                          ))}
                        </Select>
                      </div>
                    </Field>
                  ) : (
                    <div className="hidden sm:block" />
                  )}
                  <Button variant="ghost" size="icon" onClick={() => setPresets(presets.filter((_, j) => j !== i))} title={t('common.delete')}>
                    <Trash2 aria-hidden />
                    <span className="sr-only">{t('common.delete')}</span>
                  </Button>
                </div>
                <Field label={t('moderation.reason')} htmlFor={`pr-reason-${i}`}>
                  <Textarea id={`pr-reason-${i}`} rows={2} value={p.reason} maxLength={500} onChange={(e) => update(i, { reason: e.target.value })} />
                </Field>
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap justify-between gap-2">
          <Button variant="outline" onClick={() => add()} disabled={presets.length >= 50}>
            <Plus aria-hidden />
            {t('presets.add')}
          </Button>
          <Button onClick={() => void save()} disabled={busy || invalid || JSON.stringify(presets) === saved}>
            {busy ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
