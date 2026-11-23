import { Module } from '@nestjs/common';
import { PluginApiController } from './plugin-api.controller';
import { PluginAuthGuard } from './plugin-auth.guard';
import { PlayerTrackingService } from './player-tracking.service';
import { StaleServerMonitor } from './stale-server.monitor';

@Module({
  controllers: [PluginApiController],
  providers: [PluginAuthGuard, PlayerTrackingService, StaleServerMonitor],
  exports: [PlayerTrackingService, StaleServerMonitor],
})
export class PluginApiModule {}
