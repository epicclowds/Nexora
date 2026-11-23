'use client';

import { PERMISSIONS } from '@mnm/shared-types';
import { useTranslations } from 'next-intl';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { api, ApiError, errorKey, type ModerationPreset, type Punishment, type PunishmentType } from '@/lib/api';
import { useAuth } from './auth-provider';
import { useToast } from './toaster';
import { Dialog, DialogContent, DialogTrigger } from './ui/dialog';
import { Alert, Button, Field, Input, Select, Textarea } from './ui/primitives';

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
  const [presets, setPresets] = useState<ModerationPreset[]>([]);
  const [presetId, setPresetId] = useState('');

  useEffect(() => {
    if (!open) return;
    api<{ presets: ModerationPreset[] }>('/settings/moderation')
      .then((m) => setPresets(m.presets))
      .catch(() => setPresets([]));
  }, [open]);

  if (types.length === 0) return null;
  const usablePresets = presets.filter((p) => types.includes(p.type));

  function applyPreset(id: string) {
    setPresetId(id);
    const p = usablePresets.find((x) => x.id === id);
    if (!p) return;
    setType(p.type);
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
  const temporary = TEMPORARY.includes(type);
  const durationSeconds = preset === 'custom' ? amount * UNIT_SECONDS[unit] : preset;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api<Punishment>('/punishments', {
        method: 'POST',
        body: { type, target: player.trim(), reason: reason.trim(), ...(temporary ? { durationSeconds } : {}) },
      });
      toast(t('moderation.issued', { type: t(`moderation.types.${type}`), player: created.target.username }));
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

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setError(null); }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={targetName ? t('moderation.punishTitle', { player: targetName }) : t('moderation.newPunishment')} closeLabel={t('common.close')}>
        <form onSubmit={submit} className="grid gap-4">
          {error && <Alert variant="destructive">{error}</Alert>}
          {!target && (
            <Field label={t('moderation.punishTarget')} htmlFor="pun-target">
              <Input id="pun-target" value={player} onChange={(e) => setPlayer(e.target.value)} maxLength={36} required autoFocus />
            </Field>
          )}
          {usablePresets.length > 0 && (
            <Field label={t('presets.template')} htmlFor="pun-preset">
              <Select id="pun-preset" value={presetId} onChange={(e) => applyPreset(e.target.value)}>
                <option value="">{t('presets.none')}</option>
                {usablePresets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
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
              <div className="grid gap-2">
                <Select id="pun-duration" value={String(preset)} onChange={(e) => setPreset(e.target.value === 'custom' ? 'custom' : Number(e.target.value))}>
                  {PRESETS.map((s) => (
                    <option key={s} value={s}>
                      {s >= 86_400 ? t('moderation.presetDays', { count: s / 86_400 }) : t('moderation.presetHours', { count: s / 3600 })}
                    </option>
                  ))}
                  <option value="custom">{t('moderation.custom')}</option>
                </Select>
                {preset === 'custom' && (
                  <div className="grid grid-cols-2 gap-2">
                    <Input aria-label={t('moderation.amount')} type="number" min={1} max={5000} value={amount} onChange={(e) => setAmount(Math.max(1, Number(e.target.value)))} />
                    <Select aria-label={t('moderation.unit')} value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
                      {(Object.keys(UNIT_SECONDS) as Unit[]).map((u) => (
                        <option key={u} value={u}>
                          {t(`moderation.units.${u}`)}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}
              </div>
            </Field>
          )}
          <Field label={t('moderation.reason')} htmlFor="pun-reason">
            <Textarea id="pun-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} required />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant={['BAN', 'TEMP_BAN', 'BLACKLIST'].includes(type) ? 'destructive' : 'default'} disabled={busy || !reason.trim() || !player.trim()}>
              {t('moderation.punish')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
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
