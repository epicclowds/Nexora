import { Module } from '@nestjs/common';
import { PluginAuthGuard } from '../plugin-api/plugin-auth.guard';
import { PluginStatisticsController, StatisticsController } from './statistics.controller';
import { StatisticsService } from './statistics.service';

@Module({ controllers: [StatisticsController, PluginStatisticsController], providers: [StatisticsService, PluginAuthGuard] })
export class StatisticsModule {}
