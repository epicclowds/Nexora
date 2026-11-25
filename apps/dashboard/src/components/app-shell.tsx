'use client';

import { PERMISSIONS } from '@mnm/shared-types';
import { BarChart3, Gavel, LayoutDashboard, LogOut, Menu, ScrollText, Server, Settings, ShieldAlert, UserCog, Users, Wifi } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
import { useRoleName } from '@/lib/use-role-name';
import { cn } from '@/lib/utils';
import { useAuth } from './auth-provider';
import { AccountAvatar, useOwnMinecraftLink } from './account-avatar';
import { Logo } from './logo';
import { LanguageSwitcher, ThemeToggle } from './preference-controls';
import { Button } from './ui/primitives';
import { UpdateNotifier } from './update-notification';

type NavKey = 'dashboard' | 'players' | 'onlinePlayers' | 'statistics' | 'moderation' | 'anticheat' | 'servers' | 'auditLogs' | 'users' | 'settings';

const NAV: { key: NavKey; href: string; icon: typeof Users; permission?: string }[] = [
  { key: 'dashboard', href: '/', icon: LayoutDashboard },
  { key: 'players', href: '/players', icon: Users, permission: PERMISSIONS.PLAYERS_VIEW },
  { key: 'onlinePlayers', href: '/players/online', icon: Wifi, permission: PERMISSIONS.PLAYERS_VIEW },
  { key: 'statistics', href: '/statistics', icon: BarChart3, permission: PERMISSIONS.PLAYERS_VIEW_STATISTICS },
  { key: 'moderation', href: '/moderation', icon: Gavel, permission: PERMISSIONS.PUNISHMENTS_HISTORY },
  { key: 'anticheat', href: '/anticheat', icon: ShieldAlert, permission: PERMISSIONS.ANTICHEAT_VIEW },
  { key: 'servers', href: '/servers', icon: Server, permission: PERMISSIONS.SERVERS_VIEW },
  { key: 'auditLogs', href: '/audit', icon: ScrollText, permission: PERMISSIONS.AUDIT_VIEW },
  { key: 'users', href: '/users', icon: UserCog, permission: PERMISSIONS.USERS_VIEW },
  { key: 'settings', href: '/settings', icon: Settings },
];

export function AppShell({ children, version }: { children: ReactNode; version: string }) {
  const t = useTranslations();
  const pathname = usePathname();
  const { user, can, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const roleName = useRoleName();

  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname === href || (pathname.startsWith(`${href}/`) && href !== '/players'));

  const nav = (
    <nav className="flex flex-col gap-0.5 p-3" aria-label={t('common.appName')}>
      {NAV.filter((item) => !item.permission || can(item.permission)).map(({ key, href, icon: Icon }) => (
        <Link
          key={key}
          href={href}
          onClick={() => setOpen(false)}
          aria-current={isActive(href) ? 'page' : undefined}
          className={cn(
            'relative flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
            isActive(href) && 'bg-accent font-medium text-foreground before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-primary',
          )}
        >
          <Icon className="size-4" aria-hidden />
          {t(`nav.${key}`)}
        </Link>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-dvh">
      <aside className={cn('fixed inset-y-0 left-0 z-40 flex w-64 max-w-[85vw] flex-col border-r bg-sidebar transition-transform lg:sticky lg:top-0 lg:h-dvh lg:max-w-none lg:translate-x-0', open ? 'translate-x-0' : '-translate-x-full')}>
        <div className="flex h-16 items-center gap-3 border-b px-5">
          <Logo />
          <div className="min-w-0 leading-tight">
            <div className="truncate font-semibold tracking-tight">{t('common.appName')}</div>
            <div className="truncate text-xs text-muted-foreground" title={t('common.appSubtitle')}>
              {t('common.appSubtitle')}
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">{nav}</div>
        <div className="grid gap-2 border-t p-3">
          <LanguageSwitcher persist className="w-full [&_select]:w-full" />
          <div className="flex min-w-0 items-center justify-between gap-2">
            <span className="min-w-0 truncate pl-1 text-xs tabular-nums text-muted-foreground" title={t('common.version', { version })}>
              {t('common.version', { version })}
            </span>
            <ThemeToggle persist />
          </div>
          <SidebarProfile roleName={roleName({ key: user.roleKey, name: user.roleKey })} onSignOut={() => void signOut()} />
        </div>
      </aside>
      {open && <button type="button" aria-label={t('common.close')} className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setOpen(false)} />}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur lg:px-8">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)}>
            <Menu aria-hidden />
            <span className="sr-only">{t('nav.toggleSidebar')}</span>
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <UpdateNotifier />
          </div>
        </header>
        <main className="flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

/** Signed-in account: Minecraft head (when linked) or the default avatar, username, dashboard role, sign-out. */
function SidebarProfile({ roleName, onSignOut }: { roleName: string; onSignOut: () => void }) {
  const t = useTranslations();
  const { user } = useAuth();
  const minecraft = useOwnMinecraftLink();
  const link = minecraft?.link ?? null;
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-lg border bg-background/60 p-2">
      <Link href="/settings" className="flex min-w-0 flex-1 items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" title={link ? t('staff.linkedAs', { name: link.minecraftUsername }) : undefined}>
        <AccountAvatar username={user.username} minecraftUuid={link?.minecraftUuid} minecraftUsername={link?.minecraftUsername} size={36} />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-sm font-medium">{user.username}</span>
          <span className="block truncate text-xs text-muted-foreground">{roleName}</span>
        </span>
      </Link>
      <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={onSignOut} title={t('common.signOut')}>
        <LogOut aria-hidden />
        <span className="sr-only">{t('common.signOut')}</span>
      </Button>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}
