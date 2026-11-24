'use client';

import { ALL_PERMISSIONS, PERMISSIONS } from '@mnm/shared-types';
import { Plus } from 'lucide-react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/app-shell';
import { useAuth } from '@/components/auth-provider';
import { useToast } from '@/components/toaster';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Select, Skeleton } from '@/components/ui/primitives';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { api, errorKey, type Page } from '@/lib/api';
import { useRoleName } from '@/lib/use-role-name';
import { ConfirmDialog } from '@/components/confirm-dialog';

interface UserRow {
  id: string;
  username: string;
  email: string;
  disabled: boolean;
  twoFactorEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  role: { id: string; key: string; name: string; priority: number };
}

interface Role {
  id: string;
  key: string;
  name: string;
  priority: number;
  isSystem: boolean;
  userCount: number;
  permissions: string[];
}

export default function UsersPage() {
  const t = useTranslations();
  const format = useFormatter();
  const now = useNow({ updateInterval: 30_000 });
  const toast = useToast();
  const { user: me, can } = useAuth();
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ username: '', email: '', password: '', roleId: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const canManage = can(PERMISSIONS.USERS_MANAGE);
  const roleName = useRoleName();

  const load = useCallback(async () => {
    try {
      const [u, r] = await Promise.all([api<Page<UserRow>>('/users?pageSize=100'), api<Role[]>('/roles')]);
      setUsers(u.items);
      setRoles(r);
    } catch (err) {
      setError(t(`errors.${errorKey(err)}`));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  // Roles the current user may assign (strictly lower priority, Owner may assign all).
  const assignable = roles.filter((r) => me.roleKey === 'owner' || r.priority < me.rolePriority);

  async function createUser(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    try {
      await api('/users', { method: 'POST', body: form });
      toast(t('users.created', { username: form.username }));
      setOpen(false);
      setForm({ username: '', email: '', password: '', roleId: '' });
      await load();
    } catch (err) {
      setFormError(t(`errors.${errorKey(err)}`));
    }
  }

  async function update(u: UserRow, body: Record<string, unknown>) {
    try {
      await api(`/users/${u.id}`, { method: 'PATCH', body });
      toast(t('users.updated', { username: u.username }));
      await load();
    } catch (err) {
      toast(t(`errors.${errorKey(err)}`), 'error');
    }
  }

  return (
    <>
      <PageHeader
        title={t('users.title')}
        subtitle={users ? `${t('users.subtitle')} ${t('users.count', { count: users.length })}` : t('users.subtitle')}
        actions={
          canManage && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus aria-hidden /> {t('users.create')}
                </Button>
              </DialogTrigger>
              <DialogContent title={t('users.create')} closeLabel={t('common.close')}>
                <form onSubmit={createUser} className="grid gap-4">
                  {formError && <Alert variant="destructive">{formError}</Alert>}
                  <Field label={t('users.username')} htmlFor="nu-username">
                    <Input id="nu-username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} minLength={3} maxLength={32} required />
                  </Field>
                  <Field label={t('users.email')} htmlFor="nu-email">
                    <Input id="nu-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
                  </Field>
                  <Field label={t('users.password')} hint={t('users.passwordHint')} htmlFor="nu-password">
                    <Input id="nu-password" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} minLength={12} required />
                  </Field>
                  <Field label={t('users.role')} htmlFor="nu-role">
                    <Select id="nu-role" value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })} required>
                      <option value="" disabled>
                        –
                      </option>
                      {assignable.map((r) => (
                        <option key={r.id} value={r.id}>
                          {roleName(r)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <div className="flex justify-end">
                    <Button type="submit" disabled={!form.roleId || form.password.length < 12}>
                      {t('common.create')}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          )
        }
      />
      {error && <Alert variant="destructive">{error}</Alert>}

      <Card>
        {!users ? (
          <div className="grid gap-2 p-5">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : users.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">{t('users.empty')}</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>{t('users.username')}</TH>
                <TH>{t('users.email')}</TH>
                <TH>{t('users.role')}</TH>
                <TH>{t('common.status')}</TH>
                <TH>{t('users.lastLogin')}</TH>
                {canManage && <TH className="text-right">{t('common.actions')}</TH>}
              </TR>
            </THead>
            <TBody>
              {users.map((u) => {
                const manageable = canManage && u.id !== me.id && (me.roleKey === 'owner' || u.role.priority < me.rolePriority);
                return (
                  <TR key={u.id}>
                    <TD className="font-medium">{u.username}</TD>
                    <TD className="text-muted-foreground">{u.email}</TD>
                    <TD>
                      {manageable ? (
                        <Select aria-label={t('users.role')} className="h-8 w-40" value={u.role.id} onChange={(e) => void update(u, { roleId: e.target.value })}>
                          {assignable.map((r) => (
                            <option key={r.id} value={r.id}>
                              {roleName(r)}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <Badge variant="outline">{roleName(u.role)}</Badge>
                      )}
                    </TD>
                    <TD>
                      <div className="flex flex-wrap gap-1">
                        {u.disabled ? <Badge variant="danger">{t('users.disabled')}</Badge> : <Badge>{t('users.active')}</Badge>}
                        {u.twoFactorEnabled && <Badge variant="info">{t('users.twoFactor')}</Badge>}
                      </div>
                    </TD>
                    <TD className="text-muted-foreground">{u.lastLoginAt ? format.relativeTime(new Date(u.lastLoginAt), now) : t('common.never')}</TD>
                    {canManage && (
                      <TD className="text-right">
                        {manageable && (
                          <div className="flex justify-end gap-1">
                            {u.twoFactorEnabled && (
                              <ConfirmDialog
                                trigger={
                                  <Button size="sm" variant="ghost">
                                    {t('users.resetTwoFactor')}
                                  </Button>
                                }
                                title={t('users.resetTwoFactorTitle', { user: u.username })}
                                description={t('users.resetTwoFactorDescription')}
                                confirmLabel={t('users.resetTwoFactor')}
                                destructive
                                onConfirm={() => update(u, { resetTwoFactor: true })}
                              />
                            )}
                            <Button size="sm" variant={u.disabled ? 'outline' : 'ghost'} onClick={() => void update(u, { disabled: !u.disabled })}>
                              {u.disabled ? t('users.enable') : t('users.disable')}
                            </Button>
                          </div>
                        )}
                      </TD>
                    )}
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>

      <RolesPanel roles={roles} onSaved={load} />
    </>
  );
}

function RolesPanel({ roles, onSaved }: { roles: Role[]; onSaved: () => Promise<void> }) {
  const t = useTranslations();
  const toast = useToast();
  const { user: me, can } = useAuth();
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const role = roles.find((r) => r.id === selected) ?? roles[0];
  const roleName = useRoleName();

  useEffect(() => {
    if (role) setDraft(new Set(role.permissions));
  }, [role]);

  if (!role) return null;
  const editable = can(PERMISSIONS.ROLES_MANAGE) && role.key !== 'owner' && (me.roleKey === 'owner' || role.priority < me.rolePriority);

  async function save() {
    try {
      await api(`/roles/${role.id}`, { method: 'PATCH', body: { permissions: [...draft] } });
      toast(t('roles.saved', { role: roleName(role) }));
      await onSaved();
    } catch (err) {
      toast(t(`errors.${errorKey(err)}`), 'error');
    }
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>{t('roles.title')}</CardTitle>
        <CardDescription>{t('roles.subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-[220px_1fr]">
        <ul className="grid content-start gap-1">
          {roles.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setSelected(r.id)}
                className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-accent ${r.id === role.id ? 'bg-accent font-medium' : ''}`}
              >
                <span>{roleName(r)}</span>
                <span className="text-xs text-muted-foreground">{t('roles.users', { count: r.userCount })}</span>
              </button>
            </li>
          ))}
        </ul>
        <div>
          {role.key === 'owner' ? (
            <Alert>{t('roles.ownerLocked')}</Alert>
          ) : (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                {ALL_PERMISSIONS.map((p) => (
                  <label key={p} className="flex items-center gap-2 rounded-md border px-3 py-2 font-mono text-xs">
                    <input
                      type="checkbox"
                      className="accent-[var(--primary)]"
                      checked={draft.has(p)}
                      disabled={!editable}
                      onChange={(e) => {
                        const next = new Set(draft);
                        if (e.target.checked) next.add(p);
                        else next.delete(p);
                        setDraft(next);
                      }}
                    />
                    {p}
                  </label>
                ))}
              </div>
              {editable && (
                <div className="mt-4 flex justify-end">
                  <Button onClick={() => void save()}>{t('common.save')}</Button>
                </div>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
