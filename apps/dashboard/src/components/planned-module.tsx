'use client';

import { Construction } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { PageHeader } from './app-shell';

type Module = 'players' | 'onlinePlayers' | 'statistics' | 'moderation' | 'anticheat';

/** Honest placeholder for modules scheduled in later phases – shows no fake data. */
export function PlannedModule({ module }: { module: Module }) {
  const t = useTranslations();
  const name = t(`nav.${module}`);
  return (
    <>
      <PageHeader title={name} />
      <div className="flex flex-col items-center rounded-xl border border-dashed p-12 text-center">
        <Construction className="size-10 text-gold" aria-hidden />
        <h2 className="mt-4 text-lg font-semibold">{t('planned.title')}</h2>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">{t('planned.description', { module: name })}</p>
      </div>
    </>
  );
}
