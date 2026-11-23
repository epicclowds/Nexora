import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { AuthProvider } from '@/components/auth-provider';
import { Logo } from '@/components/logo';
import { Skeleton } from '@/components/ui/primitives';
import pkg from '../../../package.json';

function ShellSkeleton() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <Logo className="size-12 animate-pulse" />
        <Skeleton className="h-2 w-32" />
      </div>
    </div>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider fallback={<ShellSkeleton />}>
      <AppShell version={pkg.version}>{children}</AppShell>
    </AuthProvider>
  );
}
