import { SYSTEM_ROLES, type SystemRole } from '@mnm/shared-types';
import { useTranslations } from 'next-intl';

/** Localized name for system roles; custom roles keep their stored name. */
export function useRoleName() {
  const t = useTranslations('roles.names');
  return (role: { key: string; name: string }) =>
    (SYSTEM_ROLES as readonly string[]).includes(role.key) ? t(role.key as SystemRole) : role.name;
}
