import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Providers } from '@/components/providers';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('common');
  return { title: { default: t('appName'), template: `%s · ${t('appName')}` }, robots: { index: false, follow: false } };
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#141a17' },
    { media: '(prefers-color-scheme: light)', color: '#f7faf7' },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} className="dark" suppressHydrationWarning>
      <body className="min-h-dvh">
        <NextIntlClientProvider>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
