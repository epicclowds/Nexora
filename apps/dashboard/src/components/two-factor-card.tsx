'use client';

import { Download, KeyRound, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import QRCode from 'qrcode';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { useToast } from '@/components/toaster';
import { Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input } from '@/components/ui/primitives';
import { api, ApiError, errorKey } from '@/lib/api';
import { downloadFile } from '@/lib/zip';

interface Status {
  enabled: boolean;
  recoveryCodesRemaining: number;
}
type Mode = 'idle' | 'password' | 'scan' | 'codes' | 'disable' | 'regenerate';

/**
 * Settings → General: optional TOTP two-factor authentication for the
 * signed-in user (authenticator app + single-use recovery codes).
 */
export function TwoFactorCard() {
  const t = useTranslations();
  const toast = useToast();
  const [status, setStatus] = useState<Status | null>(null);
  const [mode, setMode] = useState<Mode>('idle');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api<Status>('/auth/me/2fa').then(setStatus).catch(() => undefined), []);
  useEffect(() => {
    void load();
  }, [load]);

  function reset(next: Mode = 'idle') {
    setMode(next);
    setPassword('');
    setCode('');
    setError(null);
  }

  function message(err: unknown): string {
    if (err instanceof ApiError && err.code === 'INVALID_PASSWORD') return t('twoFactor.invalidPassword');
    if (err instanceof ApiError && err.code === 'INVALID_TWO_FACTOR_CODE') return t('auth.twoFactorInvalid');
    if (err instanceof ApiError && err.code === 'TWO_FACTOR_SETUP_EXPIRED') return t('twoFactor.setupExpired');
    return t(`errors.${errorKey(err)}`);
  }

  async function run(e: FormEvent, action: () => Promise<void>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  const startSetup = (e: FormEvent) =>
    run(e, async () => {
      const result = await api<{ secret: string; otpauthUri: string }>('/auth/me/2fa/setup', { method: 'POST', body: { password } });
      // Rendered locally: the secret never leaves the browser for a QR service.
      const qr = await QRCode.toDataURL(result.otpauthUri, { margin: 1, width: 200, errorCorrectionLevel: 'M' });
      setSetup({ secret: result.secret, qr });
      reset('scan');
    });

  const confirm = (e: FormEvent) =>
    run(e, async () => {
      const result = await api<{ recoveryCodes: string[] }>('/auth/me/2fa/enable', { method: 'POST', body: { code: code.trim() } });
      setCodes(result.recoveryCodes);
      setSetup(null);
      reset('codes');
      await load();
      toast(t('twoFactor.enabled'));
    });

  const disable = (e: FormEvent) =>
    run(e, async () => {
      await api('/auth/me/2fa/disable', { method: 'POST', body: { password, code: code.trim() } });
      reset();
      await load();
      toast(t('twoFactor.disabled'));
    });

  const regenerate = (e: FormEvent) =>
    run(e, async () => {
      const result = await api<{ recoveryCodes: string[] }>('/auth/me/2fa/recovery-codes', { method: 'POST', body: { password, code: code.trim() } });
      setCodes(result.recoveryCodes);
      reset('codes');
      await load();
    });

  if (!status) return null;
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1.5">
            <CardTitle>{t('twoFactor.title')}</CardTitle>
            <CardDescription>{t('twoFactor.description')}</CardDescription>
          </div>
          <Badge variant={status.enabled ? 'default' : 'warning'} className="gap-1">
            <ShieldCheck aria-hidden className="size-3" />
            {status.enabled ? t('twoFactor.on') : t('twoFactor.off')}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {error && <Alert variant="destructive">{error}</Alert>}

        {mode === 'idle' && !status.enabled && (
          <Button className="justify-self-start" onClick={() => reset('password')}>
            <KeyRound aria-hidden />
            {t('twoFactor.enable')}
          </Button>
        )}
        {mode === 'idle' && status.enabled && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-muted-foreground">{t('twoFactor.remaining', { count: status.recoveryCodesRemaining })}</span>
            <Button variant="outline" size="sm" onClick={() => reset('regenerate')}>
              {t('twoFactor.newCodes')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => reset('disable')}>
              {t('twoFactor.disable')}
            </Button>
          </div>
        )}

        {mode === 'password' && (
          <form onSubmit={startSetup} className="grid max-w-sm gap-3">
            <Field label={t('twoFactor.password')} htmlFor="tf-password">
              <Input id="tf-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
            </Field>
            <FormButtons busy={busy} disabled={!password} label={t('common.next')} onCancel={() => reset()} />
          </form>
        )}

        {mode === 'scan' && setup && (
          <form onSubmit={confirm} className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-start">
            <img src={setup.qr} alt={t('twoFactor.qrAlt')} width={200} height={200} className="rounded-md bg-white p-1" />
            <div className="grid gap-3">
              <p className="text-sm">{t('twoFactor.scan')}</p>
              <div className="grid gap-1">
                <span className="text-xs text-muted-foreground">{t('twoFactor.manual')}</span>
                <code className="rounded-md border bg-muted/40 px-3 py-2 font-mono text-sm break-all select-all">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
              </div>
              <Field label={t('auth.twoFactorCode')} htmlFor="tf-code">
                <Input id="tf-code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus />
              </Field>
              <FormButtons busy={busy} disabled={code.length !== 6} label={t('twoFactor.confirm')} onCancel={() => reset()} />
            </div>
          </form>
        )}

        {mode === 'codes' && (
          <div className="grid gap-3">
            <Alert>{t('twoFactor.codesInfo')}</Alert>
            <ul className="grid grid-cols-2 gap-2 font-mono text-sm sm:grid-cols-5">
              {codes.map((c) => (
                <li key={c} className="rounded-md border px-2 py-1 text-center">
                  {c}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => downloadFile('network-manager-recovery-codes.txt', `${codes.join('\n')}\n`, 'text/plain')}>
                <Download aria-hidden />
                {t('twoFactor.downloadCodes')}
              </Button>
              <Button
                onClick={() => {
                  setCodes([]);
                  reset();
                }}
              >
                {t('twoFactor.savedCodes')}
              </Button>
            </div>
          </div>
        )}

        {(mode === 'disable' || mode === 'regenerate') && (
          <form onSubmit={mode === 'disable' ? disable : regenerate} className="grid max-w-sm gap-3">
            <Field label={t('twoFactor.password')} htmlFor="tf-password2">
              <Input id="tf-password2" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
            </Field>
            <Field label={t('auth.twoFactorCode')} hint={t('auth.twoFactorHint')} htmlFor="tf-code2">
              <Input id="tf-code2" autoComplete="one-time-code" maxLength={16} value={code} onChange={(e) => setCode(e.target.value)} />
            </Field>
            <FormButtons
              busy={busy}
              disabled={!password || code.trim().length < 6}
              label={mode === 'disable' ? t('twoFactor.disable') : t('twoFactor.newCodes')}
              destructive={mode === 'disable'}
              onCancel={() => reset()}
            />
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function FormButtons({ busy, disabled, label, destructive, onCancel }: { busy: boolean; disabled: boolean; label: string; destructive?: boolean; onCancel: () => void }) {
  const t = useTranslations();
  return (
    <div className="flex gap-2">
      <Button type="submit" variant={destructive ? 'destructive' : 'default'} disabled={busy || disabled}>
        {busy ? t('common.saving') : label}
      </Button>
      <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
        {t('common.cancel')}
      </Button>
    </div>
  );
}
