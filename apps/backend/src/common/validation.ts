import { isValidLocaleCode } from '@mnm/shared-types';
import { z } from 'zod';
import { MIN_PASSWORD_LENGTH } from '../auth/password.service';

export function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[A-Za-z0-9_.-]+$/, 'Only letters, digits, "_", "." and "-" are allowed');
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const passwordSchema = z.string().min(MIN_PASSWORD_LENGTH).max(256);
export const localeSchema = z.string().refine(isValidLocaleCode, 'Invalid locale code');
export const timezoneSchema = z.string().max(64).refine(isValidTimezone, 'Unknown IANA timezone');
export const themeSchema = z.enum(['dark', 'light', 'system']);
