import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AntiCheatModule } from './anticheat/anticheat.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { PermissionsGuard, SessionGuard } from './auth/guards';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { ConfigModule } from './config/config.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { HealthModule } from './health/health.module';
import { I18nModule } from './i18n/i18n.module';
import { InventoryModule } from './inventory/inventory.module';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { PlayersModule } from './players/players.module';
import { PluginApiModule } from './plugin-api/plugin-api.module';
import { PrismaModule } from './prisma/prisma.module';
import { PunishmentsModule } from './punishments/punishments.module';
import { RbacModule } from './rbac/rbac.module';
import { RealtimeModule } from './realtime/realtime.module';
import { RedisModule } from './redis/redis.module';
import { RedisThrottlerStorage } from './redis/redis-throttler.storage';
import { ServersModule } from './servers/servers.module';
import { SettingsModule } from './settings/settings.module';
import { SetupModule } from './setup/setup.module';
import { StatisticsModule } from './statistics/statistics.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    RedisModule,
    ThrottlerModule.forRootAsync({
      inject: [RedisThrottlerStorage],
      useFactory: (storage: RedisThrottlerStorage) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 300 }],
        storage,
      }),
    }),
    AuditModule,
    RealtimeModule,
    AuthModule,
    HealthModule,
    SettingsModule,
    RbacModule,
    SetupModule,
    UsersModule,
    I18nModule,
    ServersModule,
    DashboardModule,
    PlayersModule,
    PluginApiModule,
    PunishmentsModule,
    MaintenanceModule,
    StatisticsModule,
    AntiCheatModule,
    InventoryModule,
  ],
  providers: [
    // Order matters: rate limiting → authentication/CSRF → authorization.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: SessionGuard },
    { provide: APP_GUARD, useExisting: PermissionsGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
