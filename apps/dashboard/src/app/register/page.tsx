'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type FormEvent, useEffect, useState } from 'react';
import { Logo } from '@/components/logo';
import { LanguageSwitcher, ThemeToggle } from '@/components/preference-controls';
import { useLinkError } from '@/components/staff-accounts';
import { Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input } from '@/components/ui/primitives';
import { api } from '@/lib/api';

/**
 * Staff registration with a code from /nexora link (only when the Owner
 * enabled it under Settings → Integrations → LuckPerms). The role comes from
 * the LuckPerms group mapping; nothing about it can be chosen here.
 */
export default function RegisterPage() {
  const t = useTranslations();
  const router = useRouter();
  const linkError = useLinkError();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [form, setForm] = useState({ code: '', username: '', email: '', password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ enabled: boolean }>('/auth/registration')
      .then((r) => setEnabled(r.enabled))
      .catch(() => setEnabled(false));
  }, []);

  const mismatch = form.confirm.length > 0 && form.confirm !== form.password;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/register-linked', { method: 'POST', body: { code: form.code.trim(), username: form.username.trim(), email: form.email.trim(), password: form.password } });
      router.replace('/login?registered=1');
    } catch (err) {
      setError(linkError(err));
    } finally {
      setBusy(false);
    }
  }

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });

  return (
    <div className="bg-blocks flex min-h-dvh flex-col">
      <div className="flex justify-end gap-2 p-4">
        <LanguageSwitcher persist={false} />
        <ThemeToggle persist={false} />
      </div>
      <div className="flex flex-1 items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="items-center text-center">
            <Logo className="mb-2 size-12" />
            <CardTitle className="text-xl">{t('register.title')}</CardTitle>
            <CardDescription>{t('register.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            {enabled === false ? (
              <div className="grid gap-4">
                <Alert>{t('register.disabled')}</Alert>
                <Link href="/login" className="text-center text-sm text-primary hover:underline">
                  {t('register.toLogin')}
                </Link>
              </div>
            ) : (
              <form onSubmit={submit} className="grid gap-4">
                {error && <Alert variant="destructive">{error}</Alert>}
                <Field label={t('staff.code')} htmlFor="reg-code" hint={t('register.codeHint')}>
                  <Input id="reg-code" className="font-mono uppercase tracking-widest" placeholder="ABCD-1234" autoComplete="one-time-code" value={form.code} onChange={set('code')} maxLength={16} required autoFocus />
                </Field>
                <Field label={t('users.username')} htmlFor="reg-username">
                  <Input id="reg-username" autoComplete="username" value={form.username} onChange={set('username')} maxLength={32} required />
                </Field>
                <Field label={t('users.email')} htmlFor="reg-email">
                  <Input id="reg-email" type="email" autoComplete="email" value={form.email} onChange={set('email')} maxLength={254} required />
                </Field>
                <Field label={t('auth.password')} htmlFor="reg-password" hint={t('register.passwordHint')}>
                  <Input id="reg-password" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} minLength={12} maxLength={256} required />
                </Field>
                <Field label={t('register.confirmPassword')} htmlFor="reg-confirm" error={mismatch ? t('register.mismatch') : null}>
                  <Input id="reg-confirm" type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} required />
                </Field>
                <Button type="submit" disabled={busy || enabled !== true || mismatch || form.password.length < 12 || form.code.trim().length < 8} className="w-full">
                  {busy ? t('auth.submitting') : t('register.submit')}
                </Button>
                <Link href="/login" className="text-center text-sm text-muted-foreground hover:text-foreground">
                  {t('register.toLogin')}
                </Link>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
