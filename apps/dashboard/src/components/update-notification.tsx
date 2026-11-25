'use client';

import { PERMISSIONS } from '@mnm/shared-types';
import { Bell, ExternalLink, X } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { ReleaseNotes } from '@/components/release-notes';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Button, buttonVariants } from '@/components/ui/primitives';
import { api, type UpdateNotification } from '@/lib/api';
import { safeHref } from '@/lib/punishment-edit';

const SESSION_KEY = 'nexora.update-banner-closed';

/**
 * Update notification in the header (users with updates.notify): a bell with
 * a dot while a newer release is available, plus a banner shown once per
 * browser session. "Dismiss" hides both for this version (stored per user on
 * the server); a newer release shows them again. Loaded once per page load,
 * not on every navigation.
 */
export function UpdateNotifier() {
  const t = useTranslations();
  const format = useFormatter();
  const { can } = useAuth();
  const allowed = can(PERMISSIONS.UPDATES_NOTIFY);
  const [notification, setNotification] = useState<UpdateNotification | null>(null);
  const [bannerClosed, setBannerClosed] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!allowed) return;
    api<{ notification: UpdateNotification | null }>('/updates/notification')
      .then((r) => {
        setNotification(r.notification);
        setBannerClosed(r.notification ? sessionStorage.getItem(SESSION_KEY) === r.notification.latestVersion : true);
      })
      .catch(() => undefined);
  }, [allowed]);

  const dismiss = useCallback(async () => {
    if (!notification) return;
    await api('/updates/notification/dismiss', { method: 'POST', body: { version: notification.latestVersion } }).catch(() => undefined);
    setNotification(null);
    setOpen(false);
  }, [notification]);

  if (!allowed || !notification) return null;
  const href = safeHref(notification.url);
  const date = notification.publishedAt ? format.dateTime(new Date(notification.publishedAt), { dateStyle: 'long' }) : null;

  const closeBanner = () => {
    sessionStorage.setItem(SESSION_KEY, notification.latestVersion);
    setBannerClosed(true);
  };

  return (
    <>
      {!bannerClosed && (
        <div role="status" className="hidden items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs md:flex">
          <span>
            {t('updates.banner', { version: notification.latestVersion })}{' '}
            <button type="button" className="font-medium text-primary hover:underline" onClick={() => setOpen(true)}>
              {t('updates.details')}
            </button>
          </span>
          <button type="button" onClick={closeBanner} className="rounded-sm opacity-70 hover:opacity-100" title={t('common.close')}>
            <X aria-hidden className="size-3.5" />
            <span className="sr-only">{t('common.close')}</span>
          </button>
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="icon" className="relative" title={t('updates.notificationTitle')}>
            <Bell aria-hidden />
            <span aria-hidden className="absolute right-2 top-2 size-2 rounded-full bg-gold" />
            <span className="sr-only">{t('updates.notificationTitle')}</span>
          </Button>
        </DialogTrigger>
        <DialogContent title={t('updates.notificationTitle')} description={t('updates.notificationText')} closeLabel={t('common.close')} className="max-w-2xl">
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">{t('updates.currentVersion')}</dt>
              <dd className="font-medium">{notification.currentVersion}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('updates.latestVersion')}</dt>
              <dd className="font-medium">{notification.latestVersion}</dd>
            </div>
            {date && (
              <div>
                <dt className="text-xs text-muted-foreground">{t('updates.releaseDate')}</dt>
                <dd className="font-medium">{date}</dd>
              </div>
            )}
          </dl>
          {notification.notes.trim() && (
            <div className="max-h-[45vh] overflow-y-auto rounded-lg border p-3">
              <ReleaseNotes markdown={notification.notes} />
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => void dismiss()}>
              {t('updates.dismiss')}
            </Button>
            <Link href="/settings?section=updates" onClick={() => setOpen(false)} className={buttonVariants({ variant: 'outline' })}>
              {t('updates.openSettings')}
            </Link>
            {href && (
              <a href={href} target="_blank" rel="noopener noreferrer" className={buttonVariants()}>
                <ExternalLink aria-hidden />
                {t('updates.viewReleaseNotes')}
              </a>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
