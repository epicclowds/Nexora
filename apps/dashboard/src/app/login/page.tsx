'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type FormEvent, Suspense, useEffect, useState } from 'react';
import { Logo } from '@/components/logo';
import { LanguageSwitcher, ThemeToggle } from '@/components/preference-controls';
import { Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input } from '@/components/ui/primitives';
import { api, ApiError, errorKey, type SetupStatus } from '@/lib/api';

function LoginForm() {
  const t = useTranslations();
  const router = useRouter();
  const params = useSearchParams();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [networkName, setNetworkName] = useState<string | null>(null);

  useEffect(() => {
    api<SetupStatus>('/setup/status')
      .then((s) => {
        if (!s.initialized) router.replace('/setup');
        else setNetworkName(s.networkName);
      })
      .catch(() => undefined);
  }, [router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/login', { method: 'POST', body: { identifier, password } });
      const next = params.get('next');
      // Only allow same-site relative redirects.
      router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setError(t('auth.invalidCredentials'));
      else if (err instanceof ApiError && err.status === 429) setError(t('auth.rateLimited'));
      else setError(t(`errors.${errorKey(err)}`));
      setBusy(false);
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="items-center text-center">
        <Logo className="mb-2 size-12" />
        <CardTitle className="text-xl">{networkName ?? t('common.appName')}</CardTitle>
        <CardDescription>{t('auth.subtitle')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          {error && <Alert variant="destructive">{error}</Alert>}
          <Field label={t('auth.identifier')} htmlFor="identifier">
            <Input id="identifier" autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required autoFocus />
          </Field>
          <Field label={t('auth.password')} htmlFor="password">
            <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <Button type="submit" disabled={busy || !identifier || !password} className="w-full">
            {busy ? t('auth.submitting') : t('auth.submit')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <div className="bg-blocks flex min-h-dvh flex-col">
      <div className="flex justify-end gap-2 p-4">
        <LanguageSwitcher persist={false} />
        <ThemeToggle persist={false} />
      </div>
      <div className="flex flex-1 items-center justify-center p-4">
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
