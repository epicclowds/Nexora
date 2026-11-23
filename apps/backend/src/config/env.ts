import { z } from 'zod';

const booleanString = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

/** Environment schema. The process refuses to start when required values are missing or weak. */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().regex(/^mysql:\/\//, 'DATABASE_URL must be a mysql:// URL'),
  REDIS_URL: z.string().regex(/^rediss?:\/\//, 'REDIS_URL must be a redis:// URL'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  /** auto = set the Secure cookie flag when the request arrived over HTTPS (honours TRUST_PROXY). */
  COOKIE_SECURE: z.enum(['auto', 'true', 'false']).default('auto'),
  TRUST_PROXY: z.string().default('loopback, linklocal, uniquelocal'),
  /** Optional fixed setup code. When empty a random code is generated and logged at startup. */
  SETUP_TOKEN: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => v === undefined || v.length >= 16, 'SETUP_TOKEN must be at least 16 characters'),
  API_DOCS_ENABLED: booleanString.default(true),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  REGISTRATION_TOKEN_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(30),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return result.data;
}
