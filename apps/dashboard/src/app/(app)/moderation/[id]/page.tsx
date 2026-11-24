'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/app-shell';
import { PunishmentDetailView } from '@/components/punishment-detail';

export default function PunishmentPage() {
  const t = useTranslations();
  const { id } = useParams<{ id: string }>();
  return (
    <>
      <Link href="/moderation" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4" />
        {t('punishment.back')}
      </Link>
      <PageHeader title={t('punishment.title')} />
      <PunishmentDetailView id={id} />
    </>
  );
}
