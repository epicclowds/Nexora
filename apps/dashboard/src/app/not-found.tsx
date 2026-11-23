import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Logo } from '@/components/logo';
import { buttonVariants } from '@/components/ui/primitives';

export default async function NotFound() {
  const t = await getTranslations();
  return (
    <div className="bg-blocks flex min-h-dvh flex-col items-center justify-center gap-4 p-4 text-center">
      <Logo className="size-14" />
      <p className="text-muted-foreground">{t('errors.notFound')}</p>
      <Link href="/" className={buttonVariants({ variant: 'outline' })}>
        {t('nav.dashboard')}
      </Link>
    </div>
  );
}
