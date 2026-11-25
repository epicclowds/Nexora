'use client';

import { PERMISSIONS } from '@mnm/shared-types';
import { Check, Link2, RefreshCw, ShieldCheck, Trash2, X } from 'lucide-react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { AccountAvatar, DefaultAvatar, refreshOwnMinecraftLink, useOwnMinecraftLink } from '@/components/account-avatar';
import { useToast } from '@/components/toaster';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Select, Skeleton } from '@/components/ui/primitives';
import { Switch } from '@/components/ui/switch';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { api, ApiError, errorKey, type PunishmentPreset } from '@/lib/api';
import { cn } from '@/lib/utils';

// ── shared types ─────────────────────────────────────────────────────

export interface MinecraftRank {
  primaryGroup: string | null;
  displayName: string | null;
  prefix: string | null;
  color: string | null;
  groups: string[];
  source: string;
  synchronizedAt: string;
}

type LuckPermsMode = 'DISABLED' | 'HYBRID' | 'MANAGED';
interface LuckPermsSettings {
  mode: LuckPermsMode;
  staleAfterMinutes: number;
  linking: { enabled: boolean; allowRegistration: boolean };
}
interface Mapping {
  id: string;
  groupName: string;
  roleId: string | null;
  dashboardAccess: boolean;
  deny: boolean;
  priority: number;
  role: { id: string; key: string; name: string } | null;
}
interface Overview {
  settings: LuckPermsSettings;
  status: { lastSyncAt: string | null; lastFullSyncAt: string | null; luckPermsVersion: string | null; serverName: string | null };
  mappings: Mapping[];
  knownGroups: string[];
  counts: { snapshots: number; linkedAccounts: number; stale: number };
}
interface RoleOption {
  id: string;
  key: string;
  name: string;
}

const HEX = /^#[0-9A-F]{6}$/i;

/** Minecraft rank badge. The colour is a validated hex value; the text is rendered as text. */
export function RankBadge({ rank, className }: { rank: MinecraftRank | null; className?: string }) {
  const t = useTranslations();
  if (!rank || !(rank.displayName || rank.primaryGroup)) return null;
  const color = rank.color && HEX.test(rank.color) ? rank.color : null;
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium', className)}
      style={color ? { borderColor: `${color}66`, color, backgroundColor: `${color}14` } : undefined}
      title={t('staff.rankTitle', { group: rank.primaryGroup ?? '–', groups: rank.groups.join(', ') || '–' })}
    >
      {rank.displayName ?? rank.primaryGroup}
    </span>
  );
}

// ── Settings → General: link your Minecraft account ─────────────────

export function MinecraftLinkCard() {
  const t = useTranslations();
  const format = useFormatter();
  const toast = useToast();
  const linkError = useLinkError();
  const { user } = useAuth();
  const state = useOwnMinecraftLink();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/account/minecraft-link', { method: 'POST', body: { code: code.trim() } });
      toast(t('staff.linked'));
      setCode('');
      await refreshOwnMinecraftLink(user.id);
    } catch (err) {
      setError(linkError(err));
    } finally {
      setBusy(false);
    }
  }

  if (state === undefined) return <Skeleton className="h-40" />;
  if (!state || (!state.linkingEnabled && !state.link)) return null;
  const link = state.link;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('staff.minecraftAccount')}</CardTitle>
        <CardDescription>{link ? t('staff.connected') : t('staff.minecraftAccountDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {link ? (
          <div className="grid gap-4">
            <div className="flex min-w-0 items-center gap-4">
              <AccountAvatar username={user.username} minecraftUuid={link.minecraftUuid} minecraftUsername={link.minecraftUsername} size={56} />
              <div className="grid min-w-0 gap-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-base font-medium">{link.minecraftUsername}</span>
                  <Badge>
                    <Check className="size-3" aria-hidden />
                    {t('staff.linkedStatus')}
                  </Badge>
                </span>
                <span className="break-all font-mono text-xs text-muted-foreground" title={t('staff.uuid')}>
                  {link.minecraftUuid}
                </span>
              </div>
            </div>
            <dl aria-label={t('staff.connectedAccount')} className="grid gap-3 rounded-lg border p-3 text-sm sm:grid-cols-3">
              <LinkFact label={t('staff.minecraftRank')}>
                {state.rank && (state.rank.displayName || state.rank.primaryGroup) ? <RankBadge rank={state.rank} /> : <span className="text-muted-foreground">{t('staff.noRank')}</span>}
              </LinkFact>
              <LinkFact label={t('staff.linkedSinceLabel')}>{format.dateTime(new Date(link.linkedAt), { dateStyle: 'long' })}</LinkFact>
              <LinkFact label={t('staff.status')}>
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-primary" aria-hidden />
                  {t('staff.linkedStatus')}
                </span>
              </LinkFact>
            </dl>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <DefaultAvatar username={user.username} size={36} />
              {t('staff.notLinked')}
            </div>
            <form onSubmit={submit} className="grid gap-3 sm:max-w-md">
              {error && <Alert variant="destructive">{error}</Alert>}
              <Field label={t('staff.code')} htmlFor="link-code" hint={t('staff.codeHint')}>
                <Input id="link-code" className="font-mono uppercase tracking-widest" placeholder="ABCD-1234" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={16} required />
              </Field>
              <Button type="submit" disabled={busy || code.trim().length < 8} className="w-fit">
                <Link2 aria-hidden />
                {t('staff.linkAccount')}
              </Button>
            </form>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function LinkFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

const LINK_ERRORS = ['INVALID_LINK_CODE', 'ALREADY_LINKED', 'LINKING_DISABLED', 'REGISTRATION_DISABLED', 'NOT_ELIGIBLE', 'TOO_MANY_ATTEMPTS', 'USERNAME_TAKEN', 'EMAIL_TAKEN'] as const;

/** Translated error text for linking and registration requests. */
export function useLinkError() {
  const t = useTranslations();
  return (err: unknown): string => {
    if (err instanceof ApiError && (LINK_ERRORS as readonly string[]).includes(err.code)) return t(`staff.errors.${err.code as (typeof LINK_ERRORS)[number]}`);
    if (err instanceof ApiError && err.status === 429) return t('staff.errors.TOO_MANY_ATTEMPTS');
    return t(`errors.${errorKey(err)}`);
  };
}

// ── Settings → Integrations → LuckPerms ─────────────────────────────

export function LuckPermsIntegration() {
  const t = useTranslations();
  const format = useFormatter();
  const now = useNow({ updateInterval: 30_000 });
  const toast = useToast();
  const [data, setData] = useState<Overview | null>(null);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [draft, setDraft] = useState<LuckPermsSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [overview, roleList] = await Promise.all([api<Overview>('/integrations/luckperms'), api<RoleOption[]>('/roles')]);
      setData(overview);
      setDraft(overview.settings);
      setRoles(roleList.filter((r) => r.key !== 'owner'));
    } catch (err) {
      setError(t(`errors.${errorKey(err)}`));
    }
  }, [t]);
  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!draft) return;
    try {
      await api('/integrations/luckperms/settings', { method: 'PUT', body: draft });
      toast(t('settings.saved'));
      await load();
    } catch (err) {
      toast(t(`errors.${errorKey(err)}`), 'error');
    }
  }

  if (error) return <Alert variant="destructive">{error}</Alert>;
  if (!data || !draft) return <Skeleton className="h-64" />;
  const s = data.status;
  const healthy = s.lastSyncAt && now.getTime() - Date.parse(s.lastSyncAt) < 15 * 60_000;
  const dirty = JSON.stringify(draft) !== JSON.stringify(data.settings);

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {t('luckperms.title')}
            <Badge variant={!s.lastSyncAt ? 'muted' : healthy ? 'default' : 'warning'}>{!s.lastSyncAt ? t('luckperms.notDetected') : healthy ? t('luckperms.connected') : t('luckperms.syncWarning')}</Badge>
          </CardTitle>
          <CardDescription>{t('luckperms.description')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            <Fact label={t('luckperms.version')}>{s.luckPermsVersion ?? '–'}</Fact>
            <Fact label={t('luckperms.lastSync')}>{s.lastSyncAt ? format.relativeTime(new Date(s.lastSyncAt), now) : t('common.never')}</Fact>
            <Fact label={t('luckperms.lastFullSync')}>{s.lastFullSyncAt ? format.relativeTime(new Date(s.lastFullSyncAt), now) : t('common.never')}</Fact>
            <Fact label={t('luckperms.proxy')}>{s.serverName ?? '–'}</Fact>
            <Fact label={t('luckperms.linkedAccounts')}>{data.counts.linkedAccounts}</Fact>
            <Fact label={t('luckperms.snapshots')}>{t('luckperms.snapshotCounts', { count: data.counts.snapshots, stale: data.counts.stale })}</Fact>
          </dl>
          {!s.lastSyncAt && <Alert>{t('luckperms.installHint')}</Alert>}

          <div role="radiogroup" aria-label={t('luckperms.mode')} className="grid gap-3 md:grid-cols-3">
            {(['DISABLED', 'HYBRID', 'MANAGED'] as LuckPermsMode[]).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={draft.mode === m}
                onClick={() => setDraft({ ...draft, mode: m })}
                className={cn('grid gap-1 rounded-lg border p-4 text-left transition-colors hover:bg-accent/50', draft.mode === m && 'border-primary bg-primary/5 ring-1 ring-primary')}
              >
                <span className="text-sm font-medium">{t(`luckperms.modes.${m}`)}</span>
                <span className="text-xs text-muted-foreground">{t(`luckperms.modeHints.${m}`)}</span>
              </button>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <ToggleRow label={t('luckperms.linkingEnabled')} hint={t('luckperms.linkingEnabledHint')} checked={draft.linking.enabled} onChange={(v) => setDraft({ ...draft, linking: { ...draft.linking, enabled: v } })} />
            <ToggleRow label={t('luckperms.registration')} hint={t('luckperms.registrationHint')} checked={draft.linking.allowRegistration} onChange={(v) => setDraft({ ...draft, linking: { ...draft.linking, allowRegistration: v } })} />
            <Field label={t('luckperms.staleAfter')} htmlFor="lp-stale" hint={t('luckperms.staleAfterHint')}>
              <Input id="lp-stale" type="number" min={5} max={1440} value={draft.staleAfterMinutes} onChange={(e) => setDraft({ ...draft, staleAfterMinutes: e.target.valueAsNumber })} />
            </Field>
          </div>
          <Alert className="flex items-start gap-2">
            <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
            {t('luckperms.ownerProtected')}
          </Alert>
          <div className="flex justify-end">
            <Button disabled={!dirty || !(draft.staleAfterMinutes >= 5 && draft.staleAfterMinutes <= 1440)} onClick={() => void save()}>
              {t('common.save')}
            </Button>
          </div>
        </CardContent>
      </Card>
      <RoleMappings mappings={data.mappings} roles={roles} knownGroups={data.knownGroups} onChange={load} />
    </div>
  );
}

function ToggleRow({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
      <div className="grid gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </div>
      <Switch aria-label={label} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

function RoleMappings({ mappings, roles, knownGroups, onChange }: { mappings: Mapping[]; roles: RoleOption[]; knownGroups: string[]; onChange: () => Promise<void> }) {
  const t = useTranslations();
  const toast = useToast();
  const [group, setGroup] = useState('');
  const [roleId, setRoleId] = useState('');
  const [deny, setDeny] = useState(false);
  const [priority, setPriority] = useState(10);

  async function send(path: string, method: string, body?: unknown) {
    try {
      await api(path, { method, body });
      toast(t('settings.saved'));
      await onChange();
    } catch (err) {
      toast(err instanceof ApiError && err.code === 'DUPLICATE_MAPPING' ? t('luckperms.duplicateMapping') : t(`errors.${errorKey(err)}`), 'error');
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    await send('/integrations/luckperms/mappings', 'POST', { groupName: group.trim().toLowerCase(), roleId: deny ? null : roleId || null, dashboardAccess: !deny && Boolean(roleId), deny, priority });
    setGroup('');
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('luckperms.mappingTitle')}</CardTitle>
        <CardDescription>{t('luckperms.mappingDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {mappings.length > 0 && (
          <Table>
            <THead>
              <TR>
                <TH>{t('luckperms.group')}</TH>
                <TH>{t('luckperms.role')}</TH>
                <TH>{t('luckperms.access')}</TH>
                <TH>{t('luckperms.priority')}</TH>
                <TH className="text-right">
                  <span className="sr-only">{t('common.actions')}</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {mappings.map((m) => (
                <TR key={m.id}>
                  <TD className="font-mono">{m.groupName}</TD>
                  <TD>{m.role?.name ?? '–'}</TD>
                  <TD>{m.deny ? <Badge variant="danger">{t('luckperms.denied')}</Badge> : m.dashboardAccess && m.roleId ? <Badge>{t('luckperms.enabled')}</Badge> : <Badge variant="muted">{t('luckperms.noAccess')}</Badge>}</TD>
                  <TD>{m.priority}</TD>
                  <TD className="text-right">
                    <Button variant="ghost" size="icon" title={t('common.delete')} onClick={() => void send(`/integrations/luckperms/mappings/${m.id}`, 'DELETE')}>
                      <Trash2 aria-hidden />
                      <span className="sr-only">{t('common.delete')}</span>
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        <form onSubmit={add} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_1fr_auto_100px_auto] sm:items-end">
          <Field label={t('luckperms.group')} htmlFor="map-group">
            <Input id="map-group" list="lp-groups" value={group} onChange={(e) => setGroup(e.target.value)} maxLength={64} required className="font-mono" />
            <datalist id="lp-groups">
              {knownGroups.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
          </Field>
          <Field label={t('luckperms.role')} htmlFor="map-role">
            <Select id="map-role" value={roleId} disabled={deny} onChange={(e) => setRoleId(e.target.value)}>
              <option value="">{t('luckperms.noRole')}</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex h-9 items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-primary" checked={deny} onChange={(e) => setDeny(e.target.checked)} />
            {t('luckperms.denyAccess')}
          </label>
          <Field label={t('luckperms.priority')} htmlFor="map-priority">
            <Input id="map-priority" type="number" min={0} max={1000} value={priority} onChange={(e) => setPriority(e.target.valueAsNumber || 0)} />
          </Field>
          <Button type="submit" disabled={!group.trim()}>
            {t('luckperms.addMapping')}
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">{t('luckperms.mappingHint')}</p>
      </CardContent>
    </Card>
  );
}

// ── User Management: staff details and permission matrix ────────────

interface StaffDetail {
  id: string;
  username: string;
  role: { key: string; name: string };
  protected: boolean;
  managedBy: 'NONE' | 'LUCKPERMS';
  status: 'ACTIVE' | 'DISABLED' | 'PENDING_LINK' | 'SYNC_WARNING';
  link: { minecraftUuid: string; minecraftUsername: string; linkedAt: string; lastVerifiedAt: string | null } | null;
  rank: MinecraftRank | null;
  synchronizedAt: string | null;
  permissionSource: 'ROLE' | 'LUCKPERMS';
  blockedReason: 'STALE_PERMISSIONS' | 'NO_PERMISSION_DATA' | null;
  special: { custom: boolean; durationOverride: boolean; permanent: boolean };
  reasons: (PunishmentPreset & { allowed: boolean })[];
  history: { id: string; previousStatus: string | null; newStatus: string; reason: string; source: string; createdAt: string }[];
}

export function StaffStatusBadge({ status }: { status: StaffDetail['status'] }) {
  const t = useTranslations();
  return <Badge variant={status === 'ACTIVE' ? 'default' : status === 'DISABLED' ? 'danger' : 'warning'}>{t(`staff.statuses.${status}`)}</Badge>;
}

export function StaffDetailDialog({ userId, username, trigger, onChange }: { userId: string; username: string; trigger: ReactNode; onChange: () => void }) {
  const t = useTranslations();
  const format = useFormatter();
  const toast = useToast();
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<StaffDetail | null>(null);
  const date = (iso: string | null) => (iso ? format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' }) : '–');

  const load = useCallback(() => {
    api<StaffDetail>(`/users/${userId}/staff`)
      .then(setDetail)
      .catch(() => setDetail(null));
  }, [userId]);
  useEffect(() => {
    if (open) load();
  }, [open, load]);

  async function action(path: string, method: string, success: string) {
    try {
      await api(path, { method });
      toast(success);
      load();
      onChange();
    } catch (err) {
      toast(t(`errors.${errorKey(err)}`), 'error');
    }
  }

  const manage = can(PERMISSIONS.USERS_MANAGE) && detail && !detail.protected;
  const categories = ['BAN', 'MUTE', 'KICK', 'WARN'] as const;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={t('staff.detailTitle', { user: username })} closeLabel={t('common.close')} className="max-w-3xl">
        {!detail ? (
          <Skeleton className="h-64" />
        ) : (
          <div className="grid max-h-[75vh] gap-5 overflow-y-auto pr-1">
            <div className="flex flex-wrap items-center gap-3">
              <AccountAvatar username={username} userId={userId} minecraftUuid={detail.link?.minecraftUuid} minecraftUsername={detail.link?.minecraftUsername} size={48} />
              <div className="grid gap-1">
                <span className="flex flex-wrap items-center gap-2 font-medium">
                  {detail.link?.minecraftUsername ?? t('staff.notLinked')}
                  <RankBadge rank={detail.rank} />
                  <StaffStatusBadge status={detail.status} />
                  {detail.protected && <Badge variant="info">{t('staff.protectedOwner')}</Badge>}
                </span>
                {detail.link && <span className="font-mono text-xs text-muted-foreground">{detail.link.minecraftUuid}</span>}
              </div>
            </div>
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
              <Fact label={t('staff.dashboardRole')}>{detail.role.name}</Fact>
              <Fact label={t('staff.primaryGroup')}>{detail.rank?.primaryGroup ?? '–'}</Fact>
              <Fact label={t('staff.permissionSource')}>{t(`staff.sources.${detail.permissionSource}`)}</Fact>
              <Fact label={t('staff.managedBy')}>{t(`staff.managers.${detail.managedBy}`)}</Fact>
              <Fact label={t('staff.lastSync')}>{date(detail.synchronizedAt)}</Fact>
              <Fact label={t('staff.linkedAt')}>{date(detail.link?.linkedAt ?? null)}</Fact>
            </dl>
            {detail.blockedReason && <Alert variant="destructive">{t(`reasons.blocked.${detail.blockedReason}`)}</Alert>}
            {detail.permissionSource === 'LUCKPERMS' && <Alert>{t('staff.luckPermsManagedHint')}</Alert>}

            <div className="grid gap-2">
              <span className="text-sm font-medium">{t('staff.matrixTitle')}</span>
              <div className="grid gap-3 sm:grid-cols-2">
                {categories.map((c) => {
                  const list = detail.reasons.filter((r) => r.category === c);
                  if (!list.length) return null;
                  return (
                    <div key={c} className="grid gap-1 rounded-lg border p-3">
                      <span className="text-xs font-medium text-muted-foreground">{t(`reasons.categories.${c}`)}</span>
                      {list.map((r) => (
                        <span key={r.id} className={cn('flex items-center gap-2 text-sm', !r.enabled && 'opacity-60')}>
                          {r.allowed ? <Check aria-label={t('staff.allowed')} className="size-4 text-primary" /> : <X aria-label={t('staff.notAllowed')} className="size-4 text-muted-foreground" />}
                          <span className="font-mono">{r.numericId}</span>
                          <span className="truncate">{r.name}</span>
                        </span>
                      ))}
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                {(['custom', 'durationOverride', 'permanent'] as const).map((k) => (
                  <Badge key={k} variant={detail.special[k] ? 'default' : 'muted'}>
                    {detail.special[k] ? '✓' : '✗'} {t(`staff.special.${k}`)}
                  </Badge>
                ))}
              </div>
            </div>

            {detail.history.length > 0 && (
              <div className="grid gap-2">
                <span className="text-sm font-medium">{t('staff.history')}</span>
                <ol className="grid gap-1 text-sm">
                  {detail.history.map((h) => (
                    <li key={h.id} className="flex flex-wrap gap-x-2">
                      <span className="text-muted-foreground">{date(h.createdAt)}</span>
                      <span className="font-medium">{h.newStatus}</span>
                      <span className="text-muted-foreground">{h.reason}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {manage && (
              <div className="flex flex-wrap justify-end gap-2">
                {detail.link && (
                  <Button variant="outline" size="sm" onClick={() => void action(`/users/${userId}/staff/recheck`, 'POST', t('staff.rechecked'))}>
                    <RefreshCw aria-hidden />
                    {t('staff.recheck')}
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => void action(`/users/${userId}/staff/revoke-sessions`, 'POST', t('staff.sessionsRevoked'))}>
                  {t('staff.revokeSessions')}
                </Button>
                {detail.link && (
                  <ConfirmDialog
                    trigger={
                      <Button variant="ghost" size="sm">
                        {t('staff.unlink')}
                      </Button>
                    }
                    title={t('staff.unlinkTitle', { user: username })}
                    description={detail.managedBy === 'LUCKPERMS' ? t('staff.unlinkManagedDescription') : t('staff.unlinkDescription')}
                    confirmLabel={t('staff.unlink')}
                    destructive
                    onConfirm={() => action(`/users/${userId}/minecraft-link`, 'DELETE', t('staff.unlinked'))}
                  />
                )}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
