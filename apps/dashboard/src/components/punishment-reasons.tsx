'use client';

import { PERMISSIONS } from '@mnm/shared-types';
import { Archive, ArchiveRestore, ArrowDownUp, Copy, Pencil, Plus, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { splitDuration, UNIT_SECONDS, type Unit } from '@/components/punishment-dialogs';
import { useToast } from '@/components/toaster';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Select, Skeleton, Textarea } from '@/components/ui/primitives';
import { Switch } from '@/components/ui/switch';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { api, ApiError, type CommandMode, errorKey, type ModerationPreset, type PresetCategory, type PunishmentPreset } from '@/lib/api';
import { cn } from '@/lib/utils';

const CATEGORIES: PresetCategory[] = ['BAN', 'MUTE', 'KICK', 'WARN'];
const MODES: CommandMode[] = ['HYBRID', 'PRESET_ONLY', 'FREE_TEXT'];

/** "30 days", "Permanent" or "–" for a preset. */
export function usePresetDuration() {
  const t = useTranslations();
  return (p: Pick<PunishmentPreset, 'category' | 'durationSeconds' | 'permanent'>) => {
    if (p.category === 'KICK' || p.category === 'WARN') return '–';
    if (p.permanent || p.durationSeconds === null) return t('moderation.permanent');
    const { amount, unit } = splitDuration(p.durationSeconds);
    return t(`punishment.units.${unit}`, { count: amount });
  };
}

/** Settings → Moderation: evidence policy, global command mode and punishment reasons. */
export function ModerationSettings() {
  const { can } = useAuth();
  return (
    <div className="grid gap-6">
      {can(PERMISSIONS.PUNISHMENT_PRESETS_MANAGE) && <CommandModeCard />}
      {can(PERMISSIONS.PUNISHMENT_PRESETS_MANAGE) && <PunishmentReasons />}
      {can(PERMISSIONS.SETTINGS_MANAGE) && <EvidencePolicyCard />}
    </div>
  );
}

function EvidencePolicyCard() {
  const t = useTranslations();
  const toast = useToast();
  const [state, setState] = useState<{ presets: ModerationPreset[]; requireEvidence: boolean } | null>(null);

  useEffect(() => {
    api<{ presets: ModerationPreset[]; requireEvidence?: boolean }>('/settings/moderation')
      .then((m) => setState({ presets: m.presets, requireEvidence: m.requireEvidence ?? false }))
      .catch(() => undefined);
  }, []);

  async function save(next: boolean) {
    if (!state) return;
    setState({ ...state, requireEvidence: next });
    try {
      await api('/settings/moderation', { method: 'PUT', body: { presets: state.presets, requireEvidence: next } });
      toast(t('settings.saved'));
    } catch (err) {
      setState({ ...state, requireEvidence: !next });
      toast(t(`errors.${errorKey(err)}`), 'error');
    }
  }

  if (!state) return null;
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-4 pt-6">
        <div className="grid gap-1">
          <span className="text-sm font-medium">{t('presets.requireEvidence')}</span>
          <span className="text-xs text-muted-foreground">{t('presets.requireEvidenceHint')}</span>
        </div>
        <Switch aria-label={t('presets.requireEvidence')} checked={state.requireEvidence} onCheckedChange={(v) => void save(v)} />
      </CardContent>
    </Card>
  );
}

function CommandModeCard() {
  const t = useTranslations();
  const toast = useToast();
  const [mode, setMode] = useState<CommandMode | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ mode: CommandMode }>('/moderation/command-mode')
      .then((r) => setMode(r.mode))
      .catch(() => undefined);
  }, []);

  async function choose(next: CommandMode) {
    if (next === mode) return;
    setBusy(true);
    try {
      await api('/moderation/command-mode', { method: 'PUT', body: { mode: next } });
      setMode(next);
      toast(t('reasons.modeSaved'));
    } catch (err) {
      toast(t(`errors.${errorKey(err)}`), 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!mode) return <Skeleton className="h-40" />;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('reasons.modeTitle')}</CardTitle>
        <CardDescription>{t('reasons.modeDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        <div role="radiogroup" aria-label={t('reasons.modeTitle')} className="grid gap-3 md:grid-cols-3">
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              disabled={busy}
              onClick={() => void choose(m)}
              className={cn(
                'grid gap-1 rounded-lg border p-4 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                mode === m && 'border-primary bg-primary/5 ring-1 ring-primary',
              )}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                {t(`reasons.modes.${m}`)}
                {m === 'HYBRID' && <Badge variant="muted">{t('reasons.recommended')}</Badge>}
              </span>
              <span className="text-xs text-muted-foreground">{t(`reasons.modeHints.${m}`)}</span>
              <code className="mt-1 text-xs text-muted-foreground">{t(`reasons.modeExamples.${m}`)}</code>
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{t('reasons.modeGlobal')}</p>
      </CardContent>
    </Card>
  );
}

type SortKey = 'id' | 'name' | 'duration';

function PunishmentReasons() {
  const t = useTranslations();
  const toast = useToast();
  const duration = usePresetDuration();
  const [presets, setPresets] = useState<PunishmentPreset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<PresetCategory | ''>('');
  const [status, setStatus] = useState<'active' | 'disabled' | 'archived' | ''>('');
  const [sort, setSort] = useState<SortKey>('id');
  const [editing, setEditing] = useState<PunishmentPreset | 'new' | null>(null);

  const load = useCallback(async () => {
    try {
      setPresets(await api<PunishmentPreset[]>('/moderation/presets?archived=true'));
      setError(null);
    } catch (err) {
      setError(t(`errors.${errorKey(err)}`));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (presets ?? []).filter((p) => {
      if (category && p.category !== category) return false;
      if (status === 'archived' ? !p.archived : p.archived) return false;
      if (status === 'active' && !p.enabled) return false;
      if (status === 'disabled' && p.enabled) return false;
      return !q || String(p.numericId) === q || p.name.toLowerCase().includes(q) || p.reason.toLowerCase().includes(q) || p.permission.includes(q);
    });
    const order = CATEGORIES;
    return [...list].sort((a, b) => {
      if (a.category !== b.category) return order.indexOf(a.category) - order.indexOf(b.category);
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'duration') return (a.permanent ? Infinity : (a.durationSeconds ?? 0)) - (b.permanent ? Infinity : (b.durationSeconds ?? 0));
      return a.numericId - b.numericId;
    });
  }, [presets, query, category, status, sort]);

  async function act(path: string, body: unknown, success: string) {
    try {
      await api(path, { method: 'POST', body });
      toast(success);
      await load();
    } catch (err) {
      toast(t(`errors.${errorKey(err)}`), 'error');
    }
  }

  async function toggle(p: PunishmentPreset, enabled: boolean) {
    try {
      await api(`/moderation/presets/${p.id}`, {
        method: 'PATCH',
        body: { version: p.version, numericId: p.numericId, name: p.name, reason: p.reason, description: p.description, durationSeconds: p.durationSeconds, permanent: p.permanent, permission: p.canonicalPermission ? null : p.permission, enabled, sortOrder: p.sortOrder },
      });
      await load();
    } catch (err) {
      toast(t(`errors.${errorKey(err)}`), 'error');
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <CardTitle>{t('reasons.title')}</CardTitle>
            <CardDescription>{t('reasons.description')}</CardDescription>
          </div>
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus aria-hidden />
            {t('reasons.add')}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {error && <Alert variant="destructive">{error}</Alert>}
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-48 flex-1">
            <Search aria-hidden className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input aria-label={t('reasons.search')} placeholder={t('reasons.search')} className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <Select aria-label={t('reasons.category')} className="w-40" value={category} onChange={(e) => setCategory(e.target.value as PresetCategory | '')}>
            <option value="">{t('reasons.allCategories')}</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`reasons.categories.${c}`)}
              </option>
            ))}
          </Select>
          <Select aria-label={t('reasons.status')} className="w-40" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="">{t('reasons.statusAll')}</option>
            <option value="active">{t('reasons.statuses.enabled')}</option>
            <option value="disabled">{t('reasons.statuses.disabled')}</option>
            <option value="archived">{t('reasons.statuses.archived')}</option>
          </Select>
          <Select aria-label={t('reasons.sort')} className="w-40" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="id">{t('reasons.sortBy.id')}</option>
            <option value="name">{t('reasons.sortBy.name')}</option>
            <option value="duration">{t('reasons.sortBy.duration')}</option>
          </Select>
        </div>
        {!presets ? (
          <Skeleton className="h-40" />
        ) : visible.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('reasons.empty')}</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH className="w-16">{t('reasons.id')}</TH>
                <TH>{t('reasons.category')}</TH>
                <TH>{t('reasons.reason')}</TH>
                <TH>{t('reasons.duration')}</TH>
                <TH>{t('reasons.permission')}</TH>
                <TH>{t('reasons.status')}</TH>
                <TH className="text-right">
                  <span className="sr-only">{t('common.actions')}</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {visible.map((p) => (
                <TR key={p.id} className={cn(!p.enabled && 'opacity-60')}>
                  <TD className="font-mono font-medium">{p.numericId}</TD>
                  <TD>
                    <Badge variant={p.category === 'BAN' ? 'danger' : p.category === 'MUTE' ? 'warning' : 'info'}>{t(`reasons.categories.${p.category}`)}</Badge>
                  </TD>
                  <TD className="min-w-48">
                    <span className="font-medium">{p.name}</span>
                    {p.reason !== p.name && <span className="block text-xs text-muted-foreground">{p.reason}</span>}
                  </TD>
                  <TD className="whitespace-nowrap">{duration(p)}</TD>
                  <TD className="font-mono text-xs text-muted-foreground">{p.permission}</TD>
                  <TD>
                    {p.archived ? (
                      <Badge variant="muted">{t('reasons.statuses.archived')}</Badge>
                    ) : (
                      <Switch aria-label={t('reasons.enabled')} checked={p.enabled} onCheckedChange={(v) => void toggle(p, v)} />
                    )}
                  </TD>
                  <TD className="text-right whitespace-nowrap">
                    {!p.archived && (
                      <Button variant="ghost" size="icon" title={t('reasons.edit')} onClick={() => setEditing(p)}>
                        <Pencil aria-hidden />
                        <span className="sr-only">{t('reasons.edit')}</span>
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" title={t('reasons.duplicate')} onClick={() => void act(`/moderation/presets/${p.id}/duplicate`, undefined, t('reasons.duplicated'))}>
                      <Copy aria-hidden />
                      <span className="sr-only">{t('reasons.duplicate')}</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title={p.archived ? t('reasons.restore') : t('reasons.archive')}
                      onClick={() => void act(`/moderation/presets/${p.id}/archive`, { archived: !p.archived }, p.archived ? t('reasons.restored') : t('reasons.archived'))}
                    >
                      {p.archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
                      <span className="sr-only">{p.archived ? t('reasons.restore') : t('reasons.archive')}</span>
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <ArrowDownUp aria-hidden className="size-3" />
          {t('reasons.idHint')}
        </p>
      </CardContent>
      {editing && <PresetEditor preset={editing === 'new' ? null : editing} existing={presets ?? []} onClose={() => setEditing(null)} onSaved={load} />}
    </Card>
  );
}

function PresetEditor({ preset, existing, onClose, onSaved }: { preset: PunishmentPreset | null; existing: PunishmentPreset[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const t = useTranslations();
  const toast = useToast();
  const [category, setCategory] = useState<PresetCategory>(preset?.category ?? 'BAN');
  const nextId = (c: PresetCategory) => {
    const taken = new Set(existing.filter((p) => p.category === c).map((p) => p.numericId));
    let id = 1;
    while (taken.has(id)) id++;
    return id;
  };
  const [numericId, setNumericId] = useState(preset?.numericId ?? nextId('BAN'));
  const [name, setName] = useState(preset?.name ?? '');
  const [reason, setReason] = useState(preset?.reason ?? '');
  const [description, setDescription] = useState(preset?.description ?? '');
  const [permanent, setPermanent] = useState(preset?.permanent ?? false);
  const initial = splitDuration(preset?.durationSeconds ?? 7 * 86_400);
  const [amount, setAmount] = useState(initial.amount);
  const [unit, setUnit] = useState<Unit>(initial.unit);
  const [permission, setPermission] = useState(preset && !preset.canonicalPermission ? preset.permission : '');
  const [enabled, setEnabled] = useState(preset?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timed = category === 'BAN' || category === 'MUTE';
  const duplicate = existing.some((p) => p.category === category && p.numericId === numericId && p.id !== preset?.id);
  const canonical = `nexora.punishment.${category.toLowerCase()}.${numericId}`;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fields = {
      name: name.trim(),
      reason: reason.trim(),
      description: description.trim() || null,
      durationSeconds: timed && !permanent ? amount * UNIT_SECONDS[unit] : null,
      permanent: timed && permanent,
      permission: permission.trim() || null,
      enabled,
      sortOrder: preset?.sortOrder ?? existing.length,
    };
    try {
      if (preset) await api(`/moderation/presets/${preset.id}`, { method: 'PATCH', body: { version: preset.version, numericId, ...fields } });
      else await api('/moderation/presets', { method: 'POST', body: { category, numericId, ...fields } });
      toast(preset ? t('reasons.saved') : t('reasons.created'));
      onClose();
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError && ['DUPLICATE_PRESET_ID', 'STALE_PRESET'].includes(err.code) ? t(`reasons.errors.${err.code as 'DUPLICATE_PRESET_ID' | 'STALE_PRESET'}`) : t(`errors.${errorKey(err)}`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={preset ? t('reasons.editTitle', { id: preset.numericId }) : t('reasons.add')} closeLabel={t('common.close')} className="max-w-xl">
        <form onSubmit={submit} className="grid max-h-[75vh] gap-4 overflow-y-auto pr-1">
          {error && <Alert variant="destructive">{error}</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('reasons.category')} htmlFor="pe-category">
              <Select
                id="pe-category"
                value={category}
                disabled={Boolean(preset)}
                onChange={(e) => {
                  const c = e.target.value as PresetCategory;
                  setCategory(c);
                  setNumericId(nextId(c));
                }}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`reasons.categories.${c}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('reasons.id')} htmlFor="pe-id" hint={t('reasons.idFieldHint')} error={duplicate ? t('reasons.errors.DUPLICATE_PRESET_ID') : null}>
              <Input id="pe-id" type="number" min={1} max={9999} value={numericId} onChange={(e) => setNumericId(e.target.valueAsNumber)} required />
            </Field>
          </div>
          <Field label={t('reasons.name')} htmlFor="pe-name">
            <Input id="pe-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
          </Field>
          <Field label={t('reasons.playerReason')} htmlFor="pe-reason" hint={t('reasons.playerReasonHint')}>
            <Textarea id="pe-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} required />
          </Field>
          <Field label={t('reasons.internalDescription')} htmlFor="pe-desc" hint={t('reasons.internalDescriptionHint')}>
            <Textarea id="pe-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} />
          </Field>
          {timed && (
            <fieldset className="grid gap-3 rounded-lg border p-3">
              <legend className="px-1 text-sm font-medium">{t('reasons.duration')}</legend>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-primary" checked={permanent} onChange={(e) => setPermanent(e.target.checked)} />
                {t('moderation.permanent')}
              </label>
              {!permanent && (
                <div className="grid grid-cols-2 gap-2">
                  <Input aria-label={t('moderation.amount')} type="number" min={1} max={5000} value={amount} onChange={(e) => setAmount(Math.max(1, e.target.valueAsNumber || 1))} />
                  <Select aria-label={t('moderation.unit')} value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
                    {(Object.keys(UNIT_SECONDS) as Unit[]).map((u) => (
                      <option key={u} value={u}>
                        {t(`moderation.units.${u}`)}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
            </fieldset>
          )}
          <Field label={t('reasons.permission')} htmlFor="pe-perm" hint={t('reasons.permissionHint', { permission: canonical })}>
            <Input id="pe-perm" className="font-mono" placeholder={canonical} value={permission} onChange={(e) => setPermission(e.target.value.toLowerCase())} maxLength={100} />
          </Field>
          <label className="flex items-center justify-between gap-4 rounded-lg border p-3 text-sm">
            <span>{t('reasons.enabled')}</span>
            <Switch checked={enabled} onCheckedChange={setEnabled} aria-label={t('reasons.enabled')} />
          </label>
          {preset && <p className="text-xs text-muted-foreground">{t('reasons.snapshotHint')}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={busy || duplicate || !name.trim() || !reason.trim() || !(numericId >= 1 && numericId <= 9999)}>
              {busy ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
