'use client';

import { PERMISSIONS } from '@mnm/shared-types';
import { ArrowDownUp, ExternalLink, History, Paperclip, Pencil, Plus, RotateCcw, ShieldAlert, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useNow, useTimeZone, useTranslations } from 'next-intl';
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { RevokeDialog } from '@/components/punishment-dialogs';
import { useLiveRefresh } from '@/components/realtime-provider';
import { useToast } from '@/components/toaster';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Select, Skeleton, Textarea } from '@/components/ui/primitives';
import { api, ApiError, errorKey, type Evidence, type EvidenceType, type PunishmentDetail, type PunishmentHistoryEntry, type PunishmentType } from '@/lib/api';
import { type DurationUnit, type ExpiryChoice, isMaterialChange, resolveExpiry, safeHref, splitSeconds, totalSeconds, UNIT_SECONDS, utcToZonedLocal } from '@/lib/punishment-edit';

const ISSUE_PERMISSION: Record<PunishmentType, string> = {
  BAN: PERMISSIONS.PUNISHMENTS_BAN,
  TEMP_BAN: PERMISSIONS.PUNISHMENTS_BAN,
  MUTE: PERMISSIONS.PUNISHMENTS_MUTE,
  TEMP_MUTE: PERMISSIONS.PUNISHMENTS_MUTE,
  KICK: PERMISSIONS.PUNISHMENTS_KICK,
  WARNING: PERMISSIONS.PUNISHMENTS_WARN,
  BLACKLIST: PERMISSIONS.PUNISHMENTS_BLACKLIST,
};
const REVOKE_PERMISSION: Record<PunishmentType, string> = {
  BAN: PERMISSIONS.PUNISHMENTS_UNBAN,
  TEMP_BAN: PERMISSIONS.PUNISHMENTS_UNBAN,
  BLACKLIST: PERMISSIONS.PUNISHMENTS_BLACKLIST,
  MUTE: PERMISSIONS.PUNISHMENTS_UNMUTE,
  TEMP_MUTE: PERMISSIONS.PUNISHMENTS_UNMUTE,
  WARNING: PERMISSIONS.PUNISHMENTS_WARN,
  KICK: PERMISSIONS.PUNISHMENTS_KICK,
};
const EVIDENCE_TYPES: EvidenceType[] = ['VIDEO', 'SCREENSHOT', 'IMAGE', 'LINK', 'TEXT', 'NOTE'];
const LINK_TYPES: EvidenceType[] = ['VIDEO', 'SCREENSHOT', 'IMAGE', 'LINK'];
const KNOWN_ERRORS = ['STALE_PUNISHMENT', 'STALE_EVIDENCE', 'DURATION_ALREADY_ELAPSED', 'INVALID_DURATION', 'NOT_ACTIVE', 'NO_CHANGES', 'ALREADY_BANNED', 'ALREADY_MUTED', 'NOT_REACTIVATABLE', 'FORBIDDEN'] as const;

/** Translated error text for punishment and evidence requests. */
function useError() {
  const t = useTranslations();
  return (err: unknown) => {
    if (err instanceof ApiError && (KNOWN_ERRORS as readonly string[]).includes(err.code)) return t(`punishment.errors.${err.code as (typeof KNOWN_ERRORS)[number]}`);
    if (err instanceof ApiError && err.status === 400 && err.issues?.length) return `${t('errors.validation')} ${err.issues.map((i) => i.message).join(' · ')}`;
    if (err instanceof ApiError && err.status === 400 && err.message) return `${t('errors.validation')} ${err.message}`;
    return t(`errors.${errorKey(err)}`);
  };
}

/** Human-readable total duration from creation, e.g. "30 days" or "Permanent". */
function useDuration() {
  const t = useTranslations();
  return (createdAt: string, expiresAt: string | null) => {
    const seconds = totalSeconds(createdAt, expiresAt);
    if (seconds === null) return t('punishment.permanent');
    const { amount, unit } = splitSeconds(seconds);
    return t(`punishment.units.${unit}`, { count: amount });
  };
}

export function PunishmentDetailView({ id }: { id: string }) {
  const t = useTranslations();
  const format = useFormatter();
  const { can } = useAuth();
  const describeDuration = useDuration();
  const [punishment, setPunishment] = useState<PunishmentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<Evidence[] | null>(null);
  const [history, setHistory] = useState<PunishmentHistoryEntry[] | null>(null);
  const canEvidence = can(PERMISSIONS.PUNISHMENTS_EVIDENCE_VIEW);
  const canHistory = can(PERMISSIONS.PUNISHMENTS_HISTORY_VIEW);

  const load = useCallback(async () => {
    try {
      const [detail, ev, hist] = await Promise.all([
        api<PunishmentDetail>(`/punishments/${id}`),
        canEvidence ? api<Evidence[]>(`/punishments/${id}/evidence`) : Promise.resolve(null),
        canHistory ? api<PunishmentHistoryEntry[]>(`/punishments/${id}/history`) : Promise.resolve(null),
      ]);
      setPunishment(detail);
      setEvidence(ev);
      setHistory(hist);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 404 ? t('punishment.notFound') : t(`errors.${errorKey(err)}`));
    }
  }, [id, canEvidence, canHistory, t]);

  useEffect(() => {
    void load();
  }, [load]);
  useLiveRefresh(['punishment.changed'], load);

  if (error) return <Alert variant="destructive">{error}</Alert>;
  if (!punishment) return <Skeleton className="h-64" />;

  const p = punishment;
  const date = (iso: string | null) => (iso ? format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' }) : '–');
  const timed = p.type !== 'KICK' && p.type !== 'WARNING';
  const canEdit = can(PERMISSIONS.PUNISHMENTS_EDIT) && can(ISSUE_PERMISSION[p.type]);

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="grid gap-1">
              <CardTitle className="flex flex-wrap items-center gap-2">
                {t(`moderation.types.${p.type}`)}
                <span className="font-mono text-sm font-normal text-muted-foreground">#{p.id}</span>
              </CardTitle>
              <CardDescription>
                <Link href={`/players/${p.target.uuid}`} className="font-medium text-foreground hover:underline">
                  {p.target.username}
                </Link>
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              {canEdit && <EditPunishmentDialog punishment={p} onSaved={load} />}
              {p.reactivatable && can(PERMISSIONS.PUNISHMENTS_REACTIVATE) && can(ISSUE_PERMISSION[p.type]) && <ReactivateDialog punishment={p} onSaved={load} />}
              {p.revocable && can(REVOKE_PERMISSION[p.type]) && <RevokeDialog punishment={p} onRevoked={() => void load()} />}
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          {p.needsReview && (
            <Alert className="flex items-start gap-2">
              <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              {t('punishment.needsReview')}
            </Alert>
          )}
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <Fact label={t('moderation.reason')}>
              <span className="whitespace-pre-wrap break-words">{p.reason}</span>
            </Fact>
            <Fact label={t('moderation.status')}>
              <Badge variant={p.status === 'ACTIVE' ? 'default' : 'muted'}>{t(`moderation.statuses.${p.status}`)}</Badge>
              {p.revokedBy && <span className="ml-2 text-xs text-muted-foreground">{t('moderation.revokedBy', { name: p.revokedBy })}</span>}
            </Fact>
            {timed && <Fact label={t('punishment.duration')}>{describeDuration(p.createdAt, p.expiresAt)}</Fact>}
            {timed && <Fact label={t('moderation.expires')}>{p.expiresAt ? date(p.expiresAt) : t('punishment.permanent')}</Fact>}
            <Fact label={t('moderation.issuer')}>
              {p.issuer.name}
              <span className="ml-1 text-xs text-muted-foreground">({t(`moderation.sources.${p.source}`)}{p.server ? ` · ${p.server.name}` : ''})</span>
            </Fact>
            <Fact label={t('moderation.created')}>{date(p.createdAt)}</Fact>
            {p.updatedAt && <Fact label={t('punishment.lastModified')}>{date(p.updatedAt)}</Fact>}
            <Fact label={t('punishment.evidence')}>
              {p.evidenceCount === 0 ? (
                <span className="text-muted-foreground">{t('punishment.evidenceNone')}</span>
              ) : (
                <a href="#evidence" className="inline-flex items-center gap-1 hover:underline">
                  <Paperclip aria-hidden className="size-3.5" />
                  {t('punishment.evidenceCount', { count: p.evidenceCount })}
                </a>
              )}
            </Fact>
            {p.revokedReason && <Fact label={t('punishment.revokedReason')}>{p.revokedReason}</Fact>}
          </dl>
          {p.staffNote && (
            <div className="grid gap-1 rounded-lg border border-dashed p-3">
              <span className="text-xs font-medium text-muted-foreground">{t('punishment.staffNote')}</span>
              <p className="whitespace-pre-wrap break-words text-sm">{p.staffNote}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {evidence && <EvidenceSection punishment={p} items={evidence} onChange={load} />}
      {history && <HistoryTimeline punishment={p} entries={history} />}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

// ── Edit ────────────────────────────────────────────────────────────

type DurationMode = ExpiryChoice['mode'];

function EditPunishmentDialog({ punishment: p, onSaved }: { punishment: PunishmentDetail; onSaved: () => Promise<void> | void }) {
  const t = useTranslations();
  const format = useFormatter();
  const timeZone = useTimeZone() ?? 'UTC';
  const toast = useToast();
  const toError = useError();
  const describeDuration = useDuration();
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'form' | 'confirm'>('form');
  const [reason, setReason] = useState(p.reason);
  const [mode, setMode] = useState<DurationMode>('keep');
  const initial = splitSeconds(totalSeconds(p.createdAt, p.expiresAt) ?? 7 * 86_400);
  const [amount, setAmount] = useState(initial.amount);
  const [unit, setUnit] = useState<DurationUnit>(initial.unit);
  const [local, setLocal] = useState(utcToZonedLocal(p.expiresAt ?? new Date(Date.now() + 7 * 86_400_000).toISOString(), timeZone));
  const [staffNote, setStaffNote] = useState(p.staffNote ?? '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  const durationAllowed = p.durationEditable && p.status === 'ACTIVE' && can(PERMISSIONS.PUNISHMENTS_EDIT_DURATION);
  const permanentAllowed = can(PERMISSIONS.PUNISHMENTS_EDIT_PERMANENT);
  const reasonAllowed = can(PERMISSIONS.PUNISHMENTS_EDIT_REASON);
  const choice: ExpiryChoice = mode === 'duration' ? { mode, amount, unit } : mode === 'date' ? { mode, local } : { mode };
  const newExpiry = durationAllowed ? resolveExpiry(choice, p.createdAt, timeZone) : undefined;
  const expiryChanged = newExpiry !== undefined && newExpiry !== p.expiresAt;
  // Switching between temporary and permanent needs the elevated permission.
  const conversion = expiryChanged && (newExpiry === null) !== (p.expiresAt === null);
  const conversionBlocked = conversion && !permanentAllowed;
  const reasonChanged = reasonAllowed && reason.trim() !== p.reason && reason.trim().length > 0;
  const noteChanged = staffNote.trim() !== (p.staffNote ?? '');
  const elapsed = expiryChanged && newExpiry !== null && Date.parse(newExpiry) <= Date.now();
  const hasChanges = reasonChanged || expiryChanged || noteChanged;
  const date = (iso: string | null) => (iso ? format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' }) : t('punishment.permanent'));

  function reset() {
    setStep('form');
    setReason(p.reason);
    setMode('keep');
    setStaffNote(p.staffNote ?? '');
    setNote('');
    setError(null);
    setStale(false);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`/punishments/${p.id}`, {
        method: 'PATCH',
        body: {
          version: p.version,
          ...(reasonChanged ? { reason: reason.trim() } : {}),
          ...(expiryChanged ? { expiresAt: newExpiry } : {}),
          ...(noteChanged ? { staffNote: staffNote.trim() || null } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      });
      // Success only after the backend confirmed the change.
      toast(t('punishment.updated'));
      setOpen(false);
      await onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'STALE_PUNISHMENT') setStale(true);
      setError(toError(err));
      setStep('form');
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (isMaterialChange({ reason: reasonChanged, expiry: expiryChanged })) setStep('confirm');
    else void save();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil aria-hidden />
          {t('punishment.edit')}
        </Button>
      </DialogTrigger>
      <DialogContent title={step === 'confirm' ? t('punishment.confirmTitle') : t('punishment.editTitle', { id: p.id })} closeLabel={t('common.close')} className="max-w-2xl">
        {error && (
          <Alert variant="destructive" className="flex flex-wrap items-center justify-between gap-2">
            {error}
            {stale && (
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  setOpen(false);
                  await onSaved();
                }}
              >
                {t('punishment.reload')}
              </Button>
            )}
          </Alert>
        )}

        {step === 'form' ? (
          <form onSubmit={submit} className="grid max-h-[70vh] gap-4 overflow-y-auto pr-1">
            <dl className="grid grid-cols-2 gap-3 rounded-lg bg-muted/40 p-3 text-sm sm:grid-cols-3">
              <Fact label={t('punishment.player')}>{p.target.username}</Fact>
              <Fact label={t('moderation.type')}>{t(`moderation.types.${p.type}`)}</Fact>
              <Fact label={t('moderation.status')}>{t(`moderation.statuses.${p.status}`)}</Fact>
              <Fact label={t('punishment.duration')}>{p.type === 'KICK' || p.type === 'WARNING' ? '–' : describeDuration(p.createdAt, p.expiresAt)}</Fact>
              <Fact label={t('moderation.expires')}>{p.type === 'KICK' || p.type === 'WARNING' ? '–' : date(p.expiresAt)}</Fact>
              <Fact label={t('moderation.issuer')}>{p.issuer.name}</Fact>
            </dl>

            <Field label={t('punishment.newReason')} htmlFor="edit-reason" hint={reasonAllowed ? undefined : t('punishment.noPermission')}>
              <Textarea id="edit-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} disabled={!reasonAllowed} />
            </Field>

            {p.durationEditable && (
              <fieldset className="grid gap-3 rounded-lg border p-3">
                <legend className="px-1 text-sm font-medium">{t('punishment.changeDuration')}</legend>
                {!durationAllowed ? (
                  <p className="text-sm text-muted-foreground">{p.status === 'ACTIVE' ? t('punishment.noPermission') : t('punishment.inactiveDuration')}</p>
                ) : (
                  <>
                    <Select aria-label={t('punishment.changeDuration')} value={mode} onChange={(e) => setMode(e.target.value as DurationMode)}>
                      <option value="keep">{t('punishment.mode.keep')}</option>
                      <option value="duration">{t('punishment.mode.duration')}</option>
                      <option value="date">{t('punishment.mode.date')}</option>
                      {permanentAllowed && <option value="permanent">{t('punishment.mode.permanent')}</option>}
                    </Select>
                    {mode === 'duration' && (
                      <div className="grid grid-cols-2 gap-2">
                        <Input aria-label={t('moderation.amount')} type="number" min={1} max={5000} value={amount} onChange={(e) => setAmount(e.target.valueAsNumber)} />
                        <Select aria-label={t('moderation.unit')} value={unit} onChange={(e) => setUnit(e.target.value as DurationUnit)}>
                          {(Object.keys(UNIT_SECONDS) as DurationUnit[]).map((u) => (
                            <option key={u} value={u}>
                              {t(`moderation.units.${u}`)}
                            </option>
                          ))}
                        </Select>
                        <p className="col-span-2 text-xs text-muted-foreground">{t('punishment.durationHint')}</p>
                      </div>
                    )}
                    {mode === 'date' && (
                      <Field label={t('punishment.newExpiry')} htmlFor="edit-date" hint={t('punishment.timeZoneHint', { zone: timeZone })}>
                        <Input id="edit-date" type="datetime-local" value={local} onChange={(e) => setLocal(e.target.value)} />
                      </Field>
                    )}
                  </>
                )}
              </fieldset>
            )}

            <Field label={t('punishment.staffNote')} htmlFor="edit-staff-note" hint={t('punishment.staffNoteHint')}>
              <Textarea id="edit-staff-note" value={staffNote} onChange={(e) => setStaffNote(e.target.value)} maxLength={5000} rows={3} />
            </Field>
            <Field label={t('punishment.changeNote')} htmlFor="edit-note" hint={t('punishment.changeNoteHint')}>
              <Input id="edit-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
            </Field>

            {(reasonChanged || expiryChanged) && (
              <div className="grid gap-1 rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm" aria-live="polite">
                <span className="font-medium">{t('punishment.preview')}</span>
                {reasonChanged && <Change label={t('moderation.reason')} from={p.reason} to={reason.trim()} />}
                {expiryChanged && (
                  <>
                    <Change label={t('punishment.duration')} from={describeDuration(p.createdAt, p.expiresAt)} to={describeDuration(p.createdAt, newExpiry ?? null)} />
                    <Change label={t('moderation.expires')} from={date(p.expiresAt)} to={date(newExpiry ?? null)} />
                  </>
                )}
              </div>
            )}
            {elapsed && <Alert variant="destructive">{t('punishment.errors.DURATION_ALREADY_ELAPSED')}</Alert>}
            {conversionBlocked && <Alert variant="destructive">{t('punishment.permanentPermission')}</Alert>}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={busy || !hasChanges || elapsed || conversionBlocked}>
                {isMaterialChange({ reason: reasonChanged, expiry: expiryChanged }) ? t('punishment.review') : busy ? t('common.saving') : t('common.save')}
              </Button>
            </div>
          </form>
        ) : (
          <div className="grid gap-4">
            <dl className="grid gap-2 text-sm">
              <Fact label={t('punishment.player')}>{p.target.username}</Fact>
              {expiryChanged && <Change label={t('punishment.duration')} from={describeDuration(p.createdAt, p.expiresAt)} to={describeDuration(p.createdAt, newExpiry ?? null)} />}
              {expiryChanged && <Change label={t('moderation.expires')} from={date(p.expiresAt)} to={date(newExpiry ?? null)} />}
              {reasonChanged && <Change label={t('moderation.reason')} from={p.reason} to={reason.trim()} />}
              {note.trim() && <Fact label={t('punishment.changeNote')}>{note.trim()}</Fact>}
            </dl>
            <p className="text-sm text-muted-foreground">{t('punishment.confirmHint')}</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setStep('form')} disabled={busy}>
                {t('common.back')}
              </Button>
              <Button onClick={() => void save()} disabled={busy}>
                {busy ? t('common.saving') : t('punishment.confirm')}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Change({ label, from, to }: { label: string; from: string; to: string }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="break-words">
        <span className="text-muted-foreground line-through">{from}</span> → <span className="font-medium">{to}</span>
      </span>
    </div>
  );
}

// ── Reactivate ──────────────────────────────────────────────────────

function ReactivateDialog({ punishment: p, onSaved }: { punishment: PunishmentDetail; onSaved: () => Promise<void> | void }) {
  const t = useTranslations();
  const format = useFormatter();
  const timeZone = useTimeZone() ?? 'UTC';
  const toast = useToast();
  const toError = useError();
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const [permanent, setPermanent] = useState(p.expiresAt === null);
  const [local, setLocal] = useState(utcToZonedLocal(new Date(Date.now() + 7 * 86_400_000).toISOString(), timeZone));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const expiresAt = permanent ? null : (resolveExpiry({ mode: 'date', local }, p.createdAt, timeZone) ?? null);
  const invalid = !permanent && (!expiresAt || Date.parse(expiresAt) <= Date.now());

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/punishments/${p.id}/reactivate`, { method: 'POST', body: { version: p.version, expiresAt, ...(note.trim() ? { note: note.trim() } : {}) } });
      toast(t('punishment.reactivated'));
      setOpen(false);
      await onSaved();
    } catch (err) {
      setError(toError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <RotateCcw aria-hidden />
          {t('punishment.reactivate')}
        </Button>
      </DialogTrigger>
      <DialogContent title={t('punishment.reactivateTitle')} description={t('punishment.reactivateDescription')} closeLabel={t('common.close')}>
        <form onSubmit={submit} className="grid gap-4">
          {error && <Alert variant="destructive">{error}</Alert>}
          {can(PERMISSIONS.PUNISHMENTS_EDIT_PERMANENT) && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-primary" checked={permanent} onChange={(e) => setPermanent(e.target.checked)} />
              {t('punishment.mode.permanent')}
            </label>
          )}
          {!permanent && (
            <Field label={t('punishment.newExpiry')} htmlFor="react-date" hint={t('punishment.timeZoneHint', { zone: timeZone })}>
              <Input id="react-date" type="datetime-local" value={local} onChange={(e) => setLocal(e.target.value)} />
            </Field>
          )}
          {!permanent && expiresAt && !invalid && <p className="text-sm">{t('punishment.activeUntil', { date: format.dateTime(new Date(expiresAt), { dateStyle: 'medium', timeStyle: 'short' }) })}</p>}
          <Field label={t('punishment.changeNote')} htmlFor="react-note">
            <Input id="react-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} required />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="destructive" disabled={busy || invalid || !note.trim() || (!permanent && p.expiresAt === null && !can(PERMISSIONS.PUNISHMENTS_EDIT_PERMANENT))}>
              {busy ? t('common.saving') : t('punishment.reactivateConfirm')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Evidence ────────────────────────────────────────────────────────

function EvidenceSection({ punishment, items, onChange }: { punishment: PunishmentDetail; items: Evidence[]; onChange: () => Promise<void> | void }) {
  const t = useTranslations();
  const { can } = useAuth();
  const [newestFirst, setNewestFirst] = useState(false);
  const sorted = useMemo(() => (newestFirst ? [...items].reverse() : items), [items, newestFirst]);

  return (
    <Card id="evidence">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="grid gap-1">
            <CardTitle>{t('punishment.evidenceTitle', { count: items.length })}</CardTitle>
            <CardDescription>{t('punishment.evidenceDescription')}</CardDescription>
          </div>
          <div className="flex gap-2">
            {items.length > 1 && (
              <Button variant="ghost" size="sm" onClick={() => setNewestFirst(!newestFirst)}>
                <ArrowDownUp aria-hidden />
                {newestFirst ? t('punishment.newestFirst') : t('punishment.oldestFirst')}
              </Button>
            )}
            {can(PERMISSIONS.PUNISHMENTS_EVIDENCE_ADD) && <EvidenceDialog punishmentId={punishment.id} onSaved={onChange} />}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('punishment.evidenceNone')}</p>
        ) : (
          <ul className="grid gap-3">
            {sorted.map((e) => (
              <EvidenceItem key={e.id} evidence={e} punishmentId={punishment.id} onChange={onChange} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function EvidenceItem({ evidence: e, punishmentId, onChange }: { evidence: Evidence; punishmentId: string; onChange: () => Promise<void> | void }) {
  const t = useTranslations();
  const format = useFormatter();
  const { can } = useAuth();
  const href = safeHref(e.url);
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });
  const known = (EVIDENCE_TYPES as string[]).includes(e.type);

  return (
    <li className="grid gap-2 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={e.type === 'NOTE' ? 'muted' : 'info'}>{known ? t(`punishment.evidenceTypes.${e.type as EvidenceType}`) : t('punishment.systemEvidence')}</Badge>
        {e.visibility === 'PUBLIC' && <Badge variant="warning">{t('punishment.visibility.PUBLIC')}</Badge>}
        <span className="font-medium break-words">{e.title ?? t('punishment.untitled')}</span>
        <span className="ml-auto flex gap-1">
          {!e.system && can(PERMISSIONS.PUNISHMENTS_EVIDENCE_EDIT) && <EvidenceDialog punishmentId={punishmentId} evidence={e} onSaved={onChange} />}
          {!e.system && can(PERMISSIONS.PUNISHMENTS_EVIDENCE_DELETE) && <RemoveEvidenceDialog punishmentId={punishmentId} evidence={e} onRemoved={onChange} />}
        </span>
      </div>
      {href && (
        // External, untrusted link: no referrer, no opener, no automatic preview.
        <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-sm break-all text-primary hover:underline">
          <ExternalLink aria-hidden className="size-3.5 shrink-0" />
          <span>
            <span className="font-medium">{new URL(href).hostname}</span>
            <span className="text-muted-foreground">{href.slice(new URL(href).origin.length)}</span>
          </span>
        </a>
      )}
      {e.description && <p className="whitespace-pre-wrap break-words text-sm">{e.description}</p>}
      <p className="text-xs text-muted-foreground">
        {t('punishment.addedBy', { name: e.createdBy ?? t('punishment.system'), date: date(e.createdAt) })}
        {e.updatedAt && ` · ${t('punishment.editedBy', { name: e.updatedBy ?? '–', date: date(e.updatedAt) })}`}
      </p>
    </li>
  );
}

function EvidenceDialog({ punishmentId, evidence, onSaved }: { punishmentId: string; evidence?: Evidence; onSaved: () => Promise<void> | void }) {
  const t = useTranslations();
  const toast = useToast();
  const toError = useError();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<EvidenceType>((evidence?.type as EvidenceType) ?? 'VIDEO');
  const [title, setTitle] = useState(evidence?.title ?? '');
  const [url, setUrl] = useState(evidence?.url ?? '');
  const [description, setDescription] = useState(evidence?.description ?? '');
  const [visibility, setVisibility] = useState<'STAFF' | 'PUBLIC'>(evidence?.visibility ?? 'STAFF');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const linkType = LINK_TYPES.includes(type);
  const urlInvalid = linkType && !safeHref(url.trim());
  const descriptionMissing = !linkType && !description.trim();

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    const fields = {
      title: title.trim(),
      url: linkType ? url.trim() : null,
      description: description.trim() || null,
      visibility: type === 'NOTE' ? 'STAFF' : visibility,
    };
    try {
      if (evidence) await api(`/punishments/${punishmentId}/evidence/${evidence.id}`, { method: 'PATCH', body: { version: evidence.version, ...fields } });
      else await api(`/punishments/${punishmentId}/evidence`, { method: 'POST', body: { type, ...fields } });
      toast(evidence ? t('punishment.evidenceUpdated') : t('punishment.evidenceAdded'));
      setOpen(false);
      await onSaved();
    } catch (err) {
      setError(toError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        setError(null);
      }}
    >
      <DialogTrigger asChild>
        {evidence ? (
          <Button variant="ghost" size="icon" title={t('punishment.editEvidence')}>
            <Pencil aria-hidden />
            <span className="sr-only">{t('punishment.editEvidence')}</span>
          </Button>
        ) : (
          <Button size="sm">
            <Plus aria-hidden />
            {t('punishment.addEvidence')}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent title={evidence ? t('punishment.editEvidence') : t('punishment.addEvidence')} closeLabel={t('common.close')} className="max-w-xl">
        <form onSubmit={submit} className="grid gap-4">
          {error && <Alert variant="destructive">{error}</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('punishment.evidenceType')} htmlFor="ev-type">
              <Select id="ev-type" value={type} onChange={(e) => setType(e.target.value as EvidenceType)} disabled={Boolean(evidence)}>
                {EVIDENCE_TYPES.map((v) => (
                  <option key={v} value={v}>
                    {t(`punishment.evidenceTypes.${v}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('punishment.visibilityLabel')} htmlFor="ev-visibility" hint={type === 'NOTE' ? t('punishment.noteStaffOnly') : undefined}>
              <Select id="ev-visibility" value={type === 'NOTE' ? 'STAFF' : visibility} onChange={(e) => setVisibility(e.target.value as 'STAFF' | 'PUBLIC')} disabled={type === 'NOTE'}>
                <option value="STAFF">{t('punishment.visibility.STAFF')}</option>
                <option value="PUBLIC">{t('punishment.visibility.PUBLIC')}</option>
              </Select>
            </Field>
          </div>
          <Field label={t('punishment.evidenceTitleLabel')} htmlFor="ev-title">
            <Input id="ev-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required />
          </Field>
          {linkType && (
            <Field label={t('punishment.evidenceUrl')} htmlFor="ev-url" hint={t('punishment.evidenceUrlHint')} error={url.trim() && urlInvalid ? t('punishment.evidenceUrlInvalid') : null}>
              <Input id="ev-url" type="url" inputMode="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} maxLength={2048} required />
            </Field>
          )}
          <Field label={t('punishment.evidenceDescriptionLabel')} htmlFor="ev-description">
            <Textarea id="ev-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={10_000} rows={5} required={!linkType} />
          </Field>
          {visibility === 'PUBLIC' && type !== 'NOTE' && <p className="text-xs text-muted-foreground">{t('punishment.publicHint')}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={busy || !title.trim() || urlInvalid || descriptionMissing}>
              {busy ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RemoveEvidenceDialog({ punishmentId, evidence, onRemoved }: { punishmentId: string; evidence: Evidence; onRemoved: () => Promise<void> | void }) {
  const t = useTranslations();
  const toast = useToast();
  const toError = useError();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api(`/punishments/${punishmentId}/evidence/${evidence.id}`, { method: 'DELETE', body: { version: evidence.version, ...(reason.trim() ? { reason: reason.trim() } : {}) } });
      toast(t('punishment.evidenceRemoved'));
      setOpen(false);
      await onRemoved();
    } catch (err) {
      setError(toError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title={t('punishment.removeEvidence')}>
          <Trash2 aria-hidden />
          <span className="sr-only">{t('punishment.removeEvidence')}</span>
        </Button>
      </DialogTrigger>
      <DialogContent title={t('punishment.removeEvidenceTitle', { title: evidence.title ?? '' })} description={t('punishment.removeEvidenceDescription')} closeLabel={t('common.close')}>
        {error && <Alert variant="destructive">{error}</Alert>}
        <Field label={t('punishment.changeNote')} htmlFor="ev-remove-reason">
          <Input id="ev-remove-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="destructive" onClick={() => void remove()} disabled={busy}>
            {t('punishment.removeEvidence')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── History ─────────────────────────────────────────────────────────

function HistoryTimeline({ punishment, entries }: { punishment: PunishmentDetail; entries: PunishmentHistoryEntry[] }) {
  const t = useTranslations();
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const describeDuration = useDuration();
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  const date = (iso: string | null) => (iso ? format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' }) : t('punishment.permanent'));

  function details(h: PunishmentHistoryEntry): ReactNode {
    const prev = h.previousValues ?? {};
    const next = h.newValues ?? {};
    switch (h.action) {
      case 'CREATED':
        return (
          <>
            <span>{t('moderation.reason')}: {str(next.reason)}</span>
            {str(next.type) !== 'KICK' && str(next.type) !== 'WARNING' && <span>{t('punishment.duration')}: {describeDuration(punishment.createdAt, str(next.expiresAt))}</span>}
          </>
        );
      case 'REASON_CHANGED':
        return <Change label={t('moderation.reason')} from={str(prev.reason) ?? ''} to={str(next.reason) ?? ''} />;
      case 'DURATION_EXTENDED':
      case 'DURATION_SHORTENED':
      case 'MADE_PERMANENT':
      case 'MADE_TEMPORARY':
      case 'REACTIVATED':
        return (
          <>
            <Change label={t('punishment.duration')} from={describeDuration(punishment.createdAt, str(prev.expiresAt))} to={describeDuration(punishment.createdAt, str(next.expiresAt))} />
            <Change label={t('moderation.expires')} from={date(str(prev.expiresAt))} to={date(str(next.expiresAt))} />
          </>
        );
      case 'EVIDENCE_ADDED':
      case 'EVIDENCE_REMOVED': {
        const e = h.action === 'EVIDENCE_ADDED' ? next : prev;
        return <span className="break-words">{str(e.title) ?? t('punishment.untitled')}</span>;
      }
      case 'EVIDENCE_UPDATED':
        return (
          <>
            {Object.keys(next)
              .filter((k) => k !== 'evidenceId')
              .map((k) => (
                <Change key={k} label={t(`punishment.evidenceFields.${k as 'title' | 'url' | 'description' | 'visibility'}`)} from={String(prev[k] ?? '–')} to={String(next[k] ?? '–')} />
              ))}
          </>
        );
      default:
        return null;
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History aria-hidden className="size-4" />
          {t('punishment.historyTitle')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="relative grid gap-4 border-l pl-5">
          {entries.map((h) => (
            <li key={h.id} className="relative grid gap-1">
              <span aria-hidden className="absolute -left-[25px] top-1.5 size-2.5 rounded-full border-2 border-background bg-primary" />
              <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <span className="font-medium">{t(`punishment.history.${h.action}`, { actor: h.actor.name })}</span>
                <time dateTime={h.createdAt} className="text-xs text-muted-foreground" title={date(h.createdAt)}>
                  {format.relativeTime(new Date(Math.min(Date.parse(h.createdAt), now.getTime())), now)}
                </time>
              </div>
              <div className="grid gap-1 text-sm text-muted-foreground">{details(h)}</div>
              {h.note && (
                <p className="text-sm">
                  <span className="text-muted-foreground">{t('punishment.changeNote')}:</span> <span className="whitespace-pre-wrap break-words">{h.note}</span>
                </p>
              )}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
