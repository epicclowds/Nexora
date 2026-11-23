'use client';

import { ThemeProvider } from 'next-themes';
import type { ReactNode } from 'react';
import { Toaster } from './toaster';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <Toaster>{children}</Toaster>
    </ThemeProvider>
  );
}
