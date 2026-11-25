'use client';

import { RANK_DISPLAY_SOURCES, type RankDisplayConfig, type RankDisplaySource, resolveRank } from '@mnm/shared-types';
import { ImageUp, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ChangeEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { RankLabel } from '@/components/rank-badge';
import { useToast } from '@/components/toaster';
import { Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Select, Skeleton } from '@/components/ui/primitives';
import { Switch } from '@/components/ui/switch';
import { api, errorKey } from '@/lib/api';
import { badgeColors, hasPrivateUseGlyph, MIN_CONTRAST, type RankDisplay } from '@/lib/rank';
import { cn } from '@/lib/utils';

/** Stored rank display as returned by the backend. */
export interface StoredRankDisplay {
  id: string;
  groupName: string;
  enabled: boolean;
  displaySource: RankDisplaySource;
  displayName: string | null;
  textColor: string | null;
  backgroundColor: string | null;
  bold: boolean;
  iconText: string | null;
  iconUrl: string | null;
  fallbackText: string | null;
  tooltip: string | null;
  updatedAt: string;
}

interface Overview {
  displays: StoredRankDisplay[];
  knownGroups: string[];
  samples: Record<string, { prefix: string | null; groupDisplay: string | null }>;
}

type Draft = Omit<StoredRankDisplay, 'id' | 'iconUrl' | 'updatedAt'>;

/** Same limit as the backend. */
export const MAX_ICON_BYTES = 64 * 1024;
const ICON_TYPES = ['image/png', 'image/webp', 'image/gif', 'image/jpeg'];
const HEX = /^#[0-9A-Fa-f]{6}$/;

export function emptyDraft(groupName: string): Draft {
  return { groupName, enabled: true, displaySource: 'CUSTOM', displayName: groupName.toUpperCase().slice(0, 64), textColor: null, backgroundColor: null, bold: false, iconText: null, fallbackText: null, tooltip: null };
}

/**
 * Live preview: the same resolution the backend applies (shared code), using
 * the group's real LuckPerms prefix and display name when one was synchronised.
 */
export function previewDisplay(draft: Draft, sample: { prefix: string | null; groupDisplay: string | null } | undefined, iconUrl: string | null): RankDisplay | null {
  const config: RankDisplayConfig = {
    id: 'preview',
    groupName: draft.groupName,
    enabled: true,
    displaySource: draft.displaySource,
    displayName: draft.displayName?.trim() || null,
    textColor: draft.textColor && HEX.test(draft.textColor) ? draft.textColor.toUpperCase() : null,
    backgroundColor: draft.backgroundColor && HEX.test(draft.backgroundColor) ? draft.backgroundColor.toUpperCase() : null,
    bold: draft.bold,
    iconText: draft.iconText?.trim() || null,
    hasIcon: false,
    fallbackText: draft.fallbackText?.trim() || null,
    tooltip: draft.tooltip?.trim() || null,
    updatedAt: new Date(0),
  };
  const rank = resolveRank(
    { primaryGroup: draft.groupName, groupDisplay: sample?.groupDisplay ?? null, prefix: sample?.prefix ?? null, groups: [draft.groupName], source: 'LUCKPERMS', synchronizedAt: new Date(0) },
    new Map([[draft.groupName, config]]),
  );
  return rank ? { ...rank.display, iconUrl } : null;
}

function toBody(d: Draft) {
  const text = (v: string | null) => (v?.trim() ? v.trim() : null);
  return {
    enabled: d.enabled,
    displaySource: d.displaySource,
    displayName: text(d.displayName),
    textColor: d.textColor || null,
    backgroundColor: d.backgroundColor || null,
    bold: d.bold,
    iconText: text(d.iconText),
    fallbackText: text(d.fallbackText),
    tooltip: text(d.tooltip),
  };
}

/** Settings → Integrations → LuckPerms → Rank display. Appearance only – permissions are not affected. */
export function RankDisplaySettings() {
  const t = useTranslations();
  const toast = useToast();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [newGroup, setNewGroup] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<Overview>('/integrations/luckperms/rank-displays'));
      setError(null);
    } catch (err) {
      setError(t(`errors.${errorKey(err)}`));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const stored = data?.displays.find((d) => d.groupName === selected) ?? null;

  useEffect(() => {
    if (!selected) return setDraft(null);
    const s = data?.displays.find((d) => d.groupName === selected);
    setDraft(s ? { groupName: s.groupName, enabled: s.enabled, displaySource: s.displaySource, displayName: s.displayName, textColor: s.textColor, backgroundColor: s.backgroundColor, bold: s.bold, iconText: s.iconText, fallbackText: s.fallbackText, tooltip: s.tooltip } : emptyDraft(selected));
  }, [selected, data]);

  const preview = useMemo(() => (draft ? previewDisplay(draft, data?.samples[draft.groupName], stored?.iconUrl ?? null) : null), [draft, data, stored]);

  if (error) return <Alert variant="destructive">{error}</Alert>;
  if (!data) return <Skeleton className="h-48" />;

  const unconfigured = data.knownGroups.filter((g) => !data.displays.some((d) => d.groupName === g));
  const colorsValid = !!draft && [draft.textColor, draft.backgroundColor].every((c) => !c || HEX.test(c));
  const nameMissing = !!draft && draft.displaySource === 'CUSTOM' && !draft.displayName?.trim();
  const dirty = !!draft && (!stored || JSON.stringify(toBody(draft)) !== JSON.stringify(toBody({ ...stored })));
  const contrast = preview ? badgeColors(preview).contrast : null;

  async function save() {
    if (!draft) return;
    setBusy(true);
    try {
      await api(`/integrations/luckperms/rank-displays/${encodeURIComponent(draft.groupName)}`, { method: 'PUT', body: toBody(draft) });
      toast(t('rankDisplay.saved'));
      await load();
    } catch (err) {
      toast(t(`errors.${errorKey(err)}`), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!selected) return;
    try {
      await api(`/integrations/luckperms/rank-displays/${encodeURIComponent(selected)}`, { method: 'DELETE' });
      toast(t('rankDisplay.removed'));
      setSelected(null);
      await load();
    } catch (err) {
      toast(t(`errors.${errorKey(err)}`), 'error');
    }
  }

  async function uploadIcon(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !selected) return;
    if (!ICON_TYPES.includes(file.type)) return toast(t('rankDisplay.iconType'), 'error');
    if (file.size > MAX_ICON_BYTES) return toast(t('rankDisplay.iconTooLarge', { kb: MAX_ICON_BYTES / 1024 }), 'error');
    const data64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    try {
      await api(`/integrations/luckperms/rank-displays/${encodeURIComponent(selected)}/icon`, { method: 'PUT', body: { data: data64 } });
      toast(t('rankDisplay.iconUploaded'));
      await load();
    } catch (err) {
      toast(t(`errors.${errorKey(err)}`), 'error');
    }
  }

  async function removeIcon() {
    if (!selected) return;
    try {
      await api(`/integrations/luckperms/rank-displays/${encodeURIComponent(selected)}/icon`, { method: 'DELETE' });
      await load();
    } catch (err) {
      toast(t(`errors.${errorKey(err)}`), 'error');
    }
  }

  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('rankDisplay.title')}</CardTitle>
        <CardDescription>{t('rankDisplay.description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 xl:grid-cols-[16rem_1fr]">
        <div className="grid content-start gap-3">
          <ul className="grid gap-1" aria-label={t('rankDisplay.groups')}>
            {data.displays.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => setSelected(d.groupName)}
                  aria-current={selected === d.groupName ? 'true' : undefined}
                  className={cn('flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent', selected === d.groupName && 'border-primary bg-accent')}
                >
                  <span className="truncate font-mono text-xs">{d.groupName}</span>
                  {!d.enabled && <Badge variant="muted">{t('rankDisplay.disabled')}</Badge>}
                </button>
              </li>
            ))}
            {!data.displays.length && <li className="text-sm text-muted-foreground">{t('rankDisplay.none')}</li>}
          </ul>
          <div className="flex gap-2">
            <Input
              aria-label={t('rankDisplay.group')}
              placeholder={t('rankDisplay.groupPlaceholder')}
              list="rank-display-groups"
              value={newGroup}
              maxLength={64}
              onChange={(e) => setNewGroup(e.target.value.toLowerCase())}
            />
            <datalist id="rank-display-groups">
              {unconfigured.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
            <Button
              variant="outline"
              size="icon"
              aria-label={t('rankDisplay.add')}
              disabled={!/^[a-z0-9_\-.]{1,64}$/.test(newGroup.trim())}
              onClick={() => {
                setSelected(newGroup.trim());
                setNewGroup('');
              }}
            >
              <Plus className="size-4" aria-hidden />
            </Button>
          </div>
        </div>

        {!draft ? (
          <p className="text-sm text-muted-foreground">{t('rankDisplay.select')}</p>
        ) : (
          <div className="grid gap-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs text-muted-foreground">{t('rankDisplay.group')}</p>
                <p className="font-mono text-sm font-medium">{draft.groupName}</p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={draft.enabled} onCheckedChange={(enabled) => set({ enabled })} aria-label={t('rankDisplay.enabled')} />
                {t('rankDisplay.enabled')}
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('rankDisplay.source')} hint={t(`rankDisplay.sourceHint.${draft.displaySource}`)} htmlFor="rd-source">
                <Select id="rd-source" value={draft.displaySource} onChange={(e) => set({ displaySource: e.target.value as RankDisplaySource })}>
                  {RANK_DISPLAY_SOURCES.map((s) => (
                    <option key={s} value={s}>
                      {t(`rankDisplay.sources.${s}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('rankDisplay.displayName')} error={nameMissing ? t('rankDisplay.nameRequired') : null} htmlFor="rd-name">
                <Input id="rd-name" value={draft.displayName ?? ''} maxLength={64} disabled={draft.displaySource !== 'CUSTOM'} onChange={(e) => set({ displayName: e.target.value })} />
              </Field>
              <ColorField id="rd-text" label={t('rankDisplay.textColor')} value={draft.textColor} onChange={(textColor) => set({ textColor })} />
              <ColorField id="rd-bg" label={t('rankDisplay.backgroundColor')} value={draft.backgroundColor} onChange={(backgroundColor) => set({ backgroundColor })} />
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={draft.bold} onCheckedChange={(bold) => set({ bold })} aria-label={t('rankDisplay.bold')} />
                {t('rankDisplay.bold')}
              </label>
            </div>

            <fieldset className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
              <legend className="px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t('rankDisplay.iconSection')}</legend>
              <Field label={t('rankDisplay.iconText')} hint={t('rankDisplay.iconTextHint')} htmlFor="rd-icon">
                <Input id="rd-icon" value={draft.iconText ?? ''} maxLength={16} onChange={(e) => set({ iconText: e.target.value })} />
              </Field>
              <Field label={t('rankDisplay.fallbackText')} hint={t('rankDisplay.fallbackHint')} htmlFor="rd-fallback">
                <Input id="rd-fallback" value={draft.fallbackText ?? ''} maxLength={64} onChange={(e) => set({ fallbackText: e.target.value })} />
              </Field>
              <Field label={t('rankDisplay.tooltip')} htmlFor="rd-tooltip">
                <Input id="rd-tooltip" value={draft.tooltip ?? ''} maxLength={200} onChange={(e) => set({ tooltip: e.target.value })} />
              </Field>
              <div className="grid gap-1.5">
                <span className="text-sm font-medium">{t('rankDisplay.customIcon')}</span>
                <div className="flex flex-wrap items-center gap-2">
                  <label className={cn('inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent', !stored && 'pointer-events-none opacity-50')}>
                    <ImageUp className="size-4" aria-hidden />
                    {t('rankDisplay.uploadIcon')}
                    <input type="file" accept={ICON_TYPES.join(',')} className="sr-only" disabled={!stored} onChange={(e) => void uploadIcon(e)} />
                  </label>
                  {stored?.iconUrl && (
                    <Button variant="ghost" size="sm" onClick={() => void removeIcon()}>
                      {t('rankDisplay.removeIcon')}
                    </Button>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">{stored ? t('rankDisplay.iconHint', { kb: MAX_ICON_BYTES / 1024 }) : t('rankDisplay.saveFirst')}</span>
              </div>
              {hasPrivateUseGlyph(draft.iconText) && <Alert className="sm:col-span-2">{t('rankDisplay.glyphWarning')}</Alert>}
            </fieldset>

            <div className="grid gap-2">
              <p className="text-sm font-medium">{t('rankDisplay.preview')}</p>
              {preview ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <PreviewSurface label={t('rankDisplay.previewLight')} dark={false} display={preview} />
                  <PreviewSurface label={t('rankDisplay.previewDark')} dark display={preview} />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t('rankDisplay.previewEmpty')}</p>
              )}
              {draft.displaySource !== 'CUSTOM' && !data.samples[draft.groupName] && <p className="text-xs text-muted-foreground">{t('rankDisplay.noSample')}</p>}
              {contrast !== null && contrast < MIN_CONTRAST && <Alert>{t('rankDisplay.lowContrast', { ratio: contrast.toFixed(1) })}</Alert>}
              <p className="text-xs text-muted-foreground">{t('rankDisplay.appearanceOnly')}</p>
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              {stored && (
                <ConfirmDialog
                  title={t('rankDisplay.removeTitle', { group: stored.groupName })}
                  description={t('rankDisplay.removeDescription')}
                  confirmLabel={t('rankDisplay.remove')}
                  destructive
                  onConfirm={remove}
                  trigger={
                    <Button variant="outline">
                      <Trash2 className="size-4" aria-hidden /> {t('rankDisplay.remove')}
                    </Button>
                  }
                />
              )}
              <Button disabled={busy || !dirty || !colorsValid || nameMissing} onClick={() => void save()}>
                {t('common.save')}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PreviewSurface({ label, dark, display }: { label: string; dark: boolean; display: RankDisplay }) {
  return (
    <div className={cn('grid gap-2 rounded-md border p-3', dark ? 'text-zinc-100' : 'text-zinc-900')} style={{ backgroundColor: dark ? '#09090B' : '#FFFFFF' }} data-theme-preview={dark ? 'dark' : 'light'}>
      <span className="text-[11px] opacity-70">{label}</span>
      <span className="flex items-center gap-2 text-sm">
        <span className="font-medium">Steve</span>
        <RankLabel display={display} title={display.tooltip ?? undefined} className={cn(!display.backgroundColor && !badgeColors(display).color && (dark ? 'border-zinc-700' : 'border-zinc-300'))} />
      </span>
    </div>
  );
}

function ColorField({ id, label, value, onChange }: { id: string; label: string; value: string | null; onChange: (value: string | null) => void }) {
  const t = useTranslations();
  const valid = !value || HEX.test(value);
  return (
    <Field label={label} error={valid ? null : t('rankDisplay.invalidColor')} htmlFor={id}>
      <div className="flex gap-2">
        <input
          type="color"
          aria-label={label}
          className="h-9 w-12 shrink-0 cursor-pointer rounded-md border bg-transparent p-1"
          value={value && HEX.test(value) ? value : '#AAAAAA'}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
        />
        <Input id={id} value={value ?? ''} placeholder={t('rankDisplay.colorAuto')} maxLength={7} onChange={(e) => onChange(e.target.value.trim() || null)} />
      </div>
    </Field>
  );
}
