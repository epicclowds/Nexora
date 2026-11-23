import { ConflictException, ForbiddenException, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { DEFAULT_LOCALE, type SetupStatus } from '@mnm/shared-types';
import { z } from 'zod';
import { PasswordService } from '../auth/password.service';
import { randomCode, sha256Hex } from '../common/crypto';
import { emailSchema, localeSchema, passwordSchema, usernameSchema } from '../common/validation';
import { AppConfig } from '../config/app-config';
import { ActorType, Prisma } from '../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { HealthService } from '../health/health.service';
import { PrismaService } from '../prisma/prisma.service';
import { OWNER_ROLE_KEY } from '../rbac/rbac.policy';
import { networkSettingsSchema, SETTING_KEYS, SettingsService } from '../settings/settings.service';

export const initializeSchema = z.object({
  setupCode: z.string().trim().min(1).max(128),
  owner: z.object({ username: usernameSchema, email: emailSchema, password: passwordSchema }),
  network: networkSettingsSchema.extend({ defaultLocale: localeSchema.default(DEFAULT_LOCALE) }),
});
export type InitializeInput = z.infer<typeof initializeSchema>;

/**
 * First-time installation. Ownership is protected by a setup code that is only
 * visible to whoever can read the backend logs (or set SETUP_TOKEN). After
 * completion the `setup.completed` row (primary key) makes re-initialisation
 * impossible, even under concurrent requests.
 */
@Injectable()
export class SetupService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SetupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    private readonly health: HealthService,
    private readonly config: AppConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (await this.isInitialized()) return;
    const code = this.config.env.SETUP_TOKEN ?? randomCode();
    await this.settings.set(SETTING_KEYS.SETUP_CODE_HASH, sha256Hex(code), null);
    const source = this.config.env.SETUP_TOKEN ? 'SETUP_TOKEN environment variable' : 'generated for this start';
    this.logger.warn('──────────────────────────────────────────────────────────');
    this.logger.warn('Installation is not initialized. Open the dashboard to run the setup wizard.');
    if (this.config.env.SETUP_TOKEN) this.logger.warn(`Setup code: taken from the ${source}.`);
    else this.logger.warn(`Setup code (${source}): ${code}`);
    this.logger.warn('──────────────────────────────────────────────────────────');
  }

  async isInitialized(): Promise<boolean> {
    return (await this.prisma.systemSetting.count({ where: { key: SETTING_KEYS.SETUP_COMPLETED } })) > 0;
  }

  async status(): Promise<SetupStatus & { networkName: string | null }> {
    const [db, redis] = await Promise.all([this.health.database(), this.health.redisStatus()]);
    let initialized = false;
    let networkName: string | null = null;
    if (db.connected) {
      initialized = await this.isInitialized().catch(() => false);
      if (initialized) networkName = (await this.settings.getNetwork()).name;
    }
    return {
      initialized,
      version: this.config.version,
      networkName,
      database: {
        connected: db.connected,
        version: db.version,
        migrationsApplied: db.migrationsApplied,
        pendingMigrations: db.pendingMigrations,
      },
      redis: { connected: redis.connected },
    };
  }

  async initialize(input: InitializeInput, ip: string | null): Promise<{ userId: string }> {
    if (await this.isInitialized()) throw new ConflictException({ code: 'ALREADY_INITIALIZED', message: 'Setup has already been completed' });

    const storedHash = await this.settings.get<string>(SETTING_KEYS.SETUP_CODE_HASH);
    const providedHash = sha256Hex(input.setupCode.trim().toUpperCase());
    const providedRawHash = sha256Hex(input.setupCode.trim());
    if (!storedHash || !(hexEqual(storedHash, providedHash) || hexEqual(storedHash, providedRawHash))) {
      await this.audit.record({ actor: { type: ActorType.SYSTEM, name: 'setup' }, action: 'setup.invalid_code', ipAddress: ip });
      throw new ForbiddenException({ code: 'INVALID_SETUP_CODE', message: 'The setup code is invalid' });
    }

    const ownerRole = await this.prisma.dashboardRole.findUniqueOrThrow({ where: { key: OWNER_ROLE_KEY } });
    const language = await this.prisma.languageSetting.findUnique({ where: { locale: input.network.defaultLocale } });
    const defaultLocale = language ? input.network.defaultLocale : DEFAULT_LOCALE;
    const passwordHash = await this.passwords.hash(input.owner.password);
    const { defaultLocale: _ignored, ...network } = input.network;

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Primary-key insert acts as a distributed lock: a concurrent second request fails here.
        await tx.systemSetting.create({ data: { key: SETTING_KEYS.SETUP_COMPLETED, value: { at: new Date().toISOString() } } });
        const owner = await tx.dashboardUser.create({
          data: {
            username: input.owner.username,
            email: input.owner.email,
            passwordHash,
            roleId: ownerRole.id,
            locale: defaultLocale,
            theme: network.defaultTheme,
            timezone: network.defaultTimezone,
          },
        });
        await this.settings.set(SETTING_KEYS.NETWORK, network, owner.id, tx);
        await tx.languageSetting.updateMany({ data: { isDefault: false } });
        await tx.languageSetting.update({ where: { locale: defaultLocale }, data: { isDefault: true, enabled: true } });
        await tx.systemSetting.delete({ where: { key: SETTING_KEYS.SETUP_CODE_HASH } });
        await this.audit.record(
          {
            actor: { type: ActorType.USER, userId: owner.id, name: owner.username },
            action: 'setup.initialized',
            targetType: 'dashboard_user',
            targetId: owner.id,
            metadata: { network: network.name, defaultLocale },
            ipAddress: ip,
          },
          tx,
        );
        return { userId: owner.id };
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({ code: 'ALREADY_INITIALIZED', message: 'Setup has already been completed' });
      }
      throw err;
    }
  }
}

function hexEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
