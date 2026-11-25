'use client';

import { PERMISSIONS } from '@mnm/shared-types';
import { useTranslations } from 'next-intl';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { api, ApiError, errorKey, type PresetCategory, type Punishment, type PunishmentPreset, type PunishmentType, type UsablePresets } from '@/lib/api';
import { useAuth } from './auth-provider';
import { useToast } from './toaster';
import { Dialog, DialogContent, DialogTrigger } from './ui/dialog';
import { Alert, Badge, Button, Field, Input, Select, Textarea } from './ui/primitives';

const TYPE_PERMISSION: Record<PunishmentType, string> = {
  BAN: PERMISSIONS.PUNISHMENTS_BAN,
  TEMP_BAN: PERMISSIONS.PUNISHMENTS_BAN,
  MUTE: PERMISSIONS.PUNISHMENTS_MUTE,
  TEMP_MUTE: PERMISSIONS.PUNISHMENTS_MUTE,
  KICK: PERMISSIONS.PUNISHMENTS_KICK,
  WARNING: PERMISSIONS.PUNISHMENTS_WARN,
  BLACKLIST: PERMISSIONS.PUNISHMENTS_BLACKLIST,
};
const TYPES: PunishmentType[] = ['WARNING', 'KICK', 'TEMP_MUTE', 'MUTE', 'TEMP_BAN', 'BAN', 'BLACKLIST'];
const REASON_ERRORS = ['PRESETS_DISABLED', 'PRESET_REQUIRED', 'UNKNOWN_PRESET', 'PRESET_DISABLED', 'PRESET_FORBIDDEN', 'CUSTOM_REASON_FORBIDDEN', 'DURATION_OVERRIDE_FORBIDDEN', 'PERMANENT_FORBIDDEN', 'DUPLICATE_PRESET_ID', 'STALE_PRESET'] as const;
const TEMPORARY: PunishmentType[] = ['TEMP_BAN', 'TEMP_MUTE'];
const PRESETS = [3600, 86_400, 3 * 86_400, 7 * 86_400, 30 * 86_400];
const UNIT_SECONDS = { minutes: 60, hours: 3600, days: 86_400, weeks: 604_800 } as const;
type Unit = keyof typeof UNIT_SECONDS;

/** Largest unit that represents the duration exactly (e.g. 1209600 → 2 weeks). */
export function splitDuration(seconds: number): { amount: number; unit: Unit } {
  for (const unit of ['weeks', 'days', 'hours', 'minutes'] as const) {
    if (seconds % UNIT_SECONDS[unit] === 0) return { amount: seconds / UNIT_SECONDS[unit], unit };
  }
  return { amount: Math.max(1, Math.round(seconds / 60)), unit: 'minutes' };
}
export { UNIT_SECONDS, TEMPORARY as TEMPORARY_TYPES, type Unit };

/** Types the current user may issue (cosmetic; the backend enforces the same rules). */
export function useIssuableTypes(): PunishmentType[] {
  const { can } = useAuth();
  return TYPES.filter((type) => can(TYPE_PERMISSION[type]));
}

/** Maps punishment-specific backend errors to messages. */
function useErrorMessage() {
  const t = useTranslations();
  return (err: unknown) => {
    if (err instanceof ApiError) {
      if (err.code === 'ALREADY_BANNED') return t('moderation.alreadyBanned');
      if (err.code === 'ALREADY_MUTED') return t('moderation.alreadyMuted');
      if (err.code === 'PLAYER_OFFLINE') return t('moderation.playerOffline');
      if (err.code === 'PLAYER_NOT_FOUND') return t('moderation.playerNotFound');
      if ((REASON_ERRORS as readonly string[]).includes(err.code)) return t(`reasons.errors.${err.code as (typeof REASON_ERRORS)[number]}`);
    }
    return t(`errors.${errorKey(err)}`);
  };
}

export function PunishDialog({ trigger, target, targetName, onIssued }: { trigger: ReactNode; target?: string; targetName?: string; onIssued?: () => void }) {
  const t = useTranslations();
  const format = useErrorMessage();
  const toast = useToast();
  const types = useIssuableTypes();
  const [open, setOpen] = useState(false);
  const [player, setPlayer] = useState(target ?? '');
  const [type, setType] = useState<PunishmentType>(types[0] ?? 'WARNING');
  const [reason, setReason] = useState('');
  const [preset, setPreset] = useState<number | 'custom'>(86_400);
  const [amount, setAmount] = useState(1);
  const [unit, setUnit] = useState<Unit>('days');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [usable, setUsable] = useState<UsablePresets | null>(null);
  /** Selected reason preset (id of the PunishmentPreset), '' = typed reason. */
  const [presetId, setPresetId] = useState('');
  const [override, setOverride] = useState(false);
  const [overridePermanent, setOverridePermanent] = useState(false);

  useEffect(() => {
    if (!open) return;
    api<UsablePresets>('/moderation/presets/usable')
      .then(setUsable)
      .catch(() => setUsable(null));
  }, [open]);

  if (types.length === 0) return null;
  // Only reasons the user may use and whose punishment type the user may issue.
  const presets = (usable?.presets ?? []).filter((p) => types.some((ty) => CATEGORY_TYPES[p.category].includes(ty)));
  const selected = presets.find((p) => p.id === presetId) ?? null;
  const typedAllowed = usable ? usable.customReasons : true;
  const presetOnly = usable?.mode === 'PRESET_ONLY';
  const usingPreset = selected !== null;
  const effectiveType: PunishmentType = selected ? presetType(selected, override ? (overridePermanent ? null : 0) : undefined) : type;
  const temporary = TEMPORARY.includes(effectiveType);
  const timedPreset = selected ? selected.category === 'BAN' || selected.category === 'MUTE' : false;
  const durationSeconds = preset === 'custom' ? amount * UNIT_SECONDS[unit] : preset;

  function choosePreset(id: string) {
    setPresetId(id);
    setOverride(false);
    setOverridePermanent(false);
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    setReason(p.reason);
    if (p.durationSeconds) {
      if (PRESETS.includes(p.durationSeconds)) setPreset(p.durationSeconds);
      else {
        const split = splitDuration(p.durationSeconds);
        setPreset('custom');
        setAmount(split.amount);
        setUnit(split.unit);
      }
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = selected
        ? {
            type: presetType(selected, undefined),
            target: player.trim(),
            presetNumericId: selected.numericId,
            ...(override && timedPreset ? { durationSeconds: overridePermanent ? null : durationSeconds } : {}),
          }
        : { type, target: player.trim(), reason: reason.trim(), ...(temporary ? { durationSeconds } : {}) };
      const created = await api<Punishment>('/punishments', { method: 'POST', body });
      toast(t('moderation.issued', { type: t(`moderation.types.${created.type}`), player: created.target.username }));
      setOpen(false);
      setReason('');
      setPresetId('');
      onIssued?.();
    } catch (err) {
      setError(format(err));
    } finally {
      setBusy(false);
    }
  }

  const blocked = usable?.blockedReason ? t(`reasons.blocked.${usable.blockedReason}`) : null;
  const canSubmit = player.trim() && (usingPreset || (typedAllowed && !presetOnly && reason.trim()));

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        setError(null);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={targetName ? t('moderation.punishTitle', { player: targetName }) : t('moderation.newPunishment')} closeLabel={t('common.close')} className="max-w-xl">
        <form onSubmit={submit} className="grid gap-4">
          {error && <Alert variant="destructive">{error}</Alert>}
          {blocked && <Alert variant="destructive">{blocked}</Alert>}
          {!target && (
            <Field label={t('moderation.punishTarget')} htmlFor="pun-target">
              <Input id="pun-target" value={player} onChange={(e) => setPlayer(e.target.value)} maxLength={36} required autoFocus />
            </Field>
          )}
          {usable && usable.mode !== 'FREE_TEXT' && (
            <Field
              label={t('reasons.selectLabel')}
              htmlFor="pun-preset"
              hint={presets.length === 0 ? t('reasons.noneUsable') : presetOnly ? t('reasons.presetOnlyHint') : t('reasons.hybridHint')}
            >
              <Select id="pun-preset" value={presetId} onChange={(e) => choosePreset(e.target.value)}>
                {!presetOnly && typedAllowed && <option value="">{t('reasons.typedReason')}</option>}
                {presetOnly && <option value="">{t('reasons.choose')}</option>}
                {(['BAN', 'MUTE', 'KICK', 'WARN'] as PresetCategory[]).map((c) => {
                  const group = presets.filter((p) => p.category === c);
                  return group.length ? (
                    <optgroup key={c} label={t(`reasons.categories.${c}`)}>
                      {group.map((p) => (
                        <option key={p.id} value={p.id}>
                          {`${p.numericId} – ${p.name}`}
                        </option>
                      ))}
                    </optgroup>
                  ) : null;
                })}
              </Select>
            </Field>
          )}
          {selected ? (
            <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={selected.category === 'BAN' ? 'danger' : selected.category === 'MUTE' ? 'warning' : 'info'}>{t('reasons.reference', { category: t(`reasons.categories.${selected.category}`), id: selected.numericId })}</Badge>
                <span className="text-muted-foreground">{t(`moderation.types.${effectiveType}`)}</span>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">{t('moderation.reason')}</span>
                <p className="whitespace-pre-wrap break-words">{selected.reason}</p>
              </div>
              {timedPreset && (
                <div className="grid gap-2">
                  <span className="text-xs text-muted-foreground">{t('moderation.duration')}</span>
                  {!override ? (
                    <span className="flex flex-wrap items-center gap-2">
                      {selected.permanent || selected.durationSeconds === null ? t('moderation.permanent') : t(`punishment.units.${splitDuration(selected.durationSeconds).unit}`, { count: splitDuration(selected.durationSeconds).amount })}
                      {usable?.durationOverride && (
                        <Button type="button" variant="ghost" size="sm" onClick={() => setOverride(true)}>
                          {t('reasons.overrideDuration')}
                        </Button>
                      )}
                    </span>
                  ) : (
                    <DurationPicker preset={preset} setPreset={setPreset} amount={amount} setAmount={setAmount} unit={unit} setUnit={setUnit} disabled={overridePermanent}>
                      {usable?.permanentOverride && (
                        <label className="flex items-center gap-2 text-sm">
                          <input type="checkbox" className="size-4 accent-primary" checked={overridePermanent} onChange={(e) => setOverridePermanent(e.target.checked)} />
                          {t('moderation.permanent')}
                        </label>
                      )}
                    </DurationPicker>
                  )}
                </div>
              )}
            </div>
          ) : presetOnly ? null : (
            <>
              <Field label={t('moderation.type')} htmlFor="pun-type" hint={type === 'BLACKLIST' ? t('moderation.blacklistHint') : undefined}>
                <Select id="pun-type" value={type} onChange={(e) => setType(e.target.value as PunishmentType)}>
                  {types.map((ty) => (
                    <option key={ty} value={ty}>
                      {t(`moderation.types.${ty}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              {temporary && (
                <Field label={t('moderation.duration')} htmlFor="pun-duration">
                  <DurationPicker preset={preset} setPreset={setPreset} amount={amount} setAmount={setAmount} unit={unit} setUnit={setUnit} />
                </Field>
              )}
              {typedAllowed ? (
                <Field label={t('moderation.reason')} htmlFor="pun-reason">
                  <Textarea id="pun-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} required />
                </Field>
              ) : (
                <Alert>{t('reasons.typedNotAllowed')}</Alert>
              )}
            </>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant={['BAN', 'TEMP_BAN', 'BLACKLIST'].includes(effectiveType) ? 'destructive' : 'default'} disabled={busy || !canSubmit}>
              {t('moderation.punish')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const CATEGORY_TYPES: Record<PresetCategory, PunishmentType[]> = {
  BAN: ['BAN', 'TEMP_BAN'],
  MUTE: ['MUTE', 'TEMP_MUTE'],
  KICK: ['KICK'],
  WARN: ['WARNING'],
};

/** Type a preset produces; override: undefined = preset duration, null = permanent, number = temporary. */
function presetType(p: PunishmentPreset, override: number | null | undefined): PunishmentType {
  const permanent = override === undefined ? p.permanent || p.durationSeconds === null : override === null;
  switch (p.category) {
    case 'BAN':
      return permanent ? 'BAN' : 'TEMP_BAN';
    case 'MUTE':
      return permanent ? 'MUTE' : 'TEMP_MUTE';
    case 'KICK':
      return 'KICK';
    case 'WARN':
      return 'WARNING';
  }
}

function DurationPicker({
  preset,
  setPreset,
  amount,
  setAmount,
  unit,
  setUnit,
  disabled,
  children,
}: {
  preset: number | 'custom';
  setPreset: (v: number | 'custom') => void;
  amount: number;
  setAmount: (v: number) => void;
  unit: Unit;
  setUnit: (v: Unit) => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const t = useTranslations();
  return (
    <div className="grid gap-2">
      <Select id="pun-duration" aria-label={t('moderation.duration')} value={String(preset)} disabled={disabled} onChange={(e) => setPreset(e.target.value === 'custom' ? 'custom' : Number(e.target.value))}>
        {PRESETS.map((s) => (
          <option key={s} value={s}>
            {s >= 86_400 ? t('moderation.presetDays', { count: s / 86_400 }) : t('moderation.presetHours', { count: s / 3600 })}
          </option>
        ))}
        <option value="custom">{t('moderation.custom')}</option>
      </Select>
      {preset === 'custom' && (
        <div className="grid grid-cols-2 gap-2">
          <Input aria-label={t('moderation.amount')} type="number" min={1} max={5000} value={amount} disabled={disabled} onChange={(e) => setAmount(Math.max(1, Number(e.target.value)))} />
          <Select aria-label={t('moderation.unit')} value={unit} disabled={disabled} onChange={(e) => setUnit(e.target.value as Unit)}>
            {(Object.keys(UNIT_SECONDS) as Unit[]).map((u) => (
              <option key={u} value={u}>
                {t(`moderation.units.${u}`)}
              </option>
            ))}
          </Select>
        </div>
      )}
      {children}
    </div>
  );
}

export function RevokeDialog({ punishment, onRevoked }: { punishment: Punishment; onRevoked?: () => void }) {
  const t = useTranslations();
  const format = useErrorMessage();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function revoke() {
    setBusy(true);
    try {
      await api(`/punishments/${punishment.id}/revoke`, { method: 'POST', body: { reason: reason.trim() || undefined } });
      toast(t('moderation.revoked'));
      setOpen(false);
      onRevoked?.();
    } catch (err) {
      toast(format(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          {t('moderation.revoke')}
        </Button>
      </DialogTrigger>
      <DialogContent title={t('moderation.revokeTitle')} description={t('moderation.revokeDescription')} closeLabel={t('common.close')}>
        <Field label={t('moderation.revokeReason')} htmlFor="rev-reason">
          <Input id="rev-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void revoke()} disabled={busy}>
            {t('moderation.revoke')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
