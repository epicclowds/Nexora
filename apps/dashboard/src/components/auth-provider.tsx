'use client';

import { hasPermission } from '@mnm/shared-types';
import { usePathname, useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { api, ApiError, type Me } from '@/lib/api';
import { browserTimeZone, storeLocale, storeTimeZone } from '@/lib/preferences';

interface AuthContextValue {
  user: Me;
  can: (permission: string) => boolean;
  reload: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Loads the signed-in user, applies their saved preferences, and guards the app routes. */
export function AuthProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { setTheme } = useTheme();
  const [user, setUser] = useState<Me | null>(null);

  const load = useCallback(async () => {
    try {
      const me = await api<Me>('/auth/me');
      setUser(me);
      const localeChanged = me.locale ? storeLocale(me.locale) : false;
      const tzChanged = storeTimeZone(me.timezone ?? browserTimeZone());
      if (me.theme) setTheme(me.theme);
      if (localeChanged || tzChanged) router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        const status = await api<{ initialized: boolean }>('/setup/status').catch(() => null);
        router.replace(status && !status.initialized ? '/setup' : `/login?next=${encodeURIComponent(pathname)}`);
      } else {
        throw err;
      }
    }
  }, [pathname, router, setTheme]);

  useEffect(() => {
    void load();
    // Only on mount: navigation inside the app keeps the session.
  }, []);

  const signOut = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    router.replace('/login');
  }, [router]);

  if (!user) return <>{fallback}</>;

  return (
    <AuthContext.Provider value={{ user, can: (p) => hasPermission(user.permissions, p), reload: load, signOut }}>{children}</AuthContext.Provider>
  );
}
