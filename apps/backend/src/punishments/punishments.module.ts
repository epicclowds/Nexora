import { Module } from '@nestjs/common';
import { PluginAuthGuard } from '../plugin-api/plugin-auth.guard';
import { PlayerModerationController } from './player-moderation.controller';
import { PunishmentEditingService } from './punishment-editing.service';
import { PluginPunishmentsController } from './plugin-punishments.controller';
import { PunishmentsController } from './punishments.controller';
import { PunishmentsService } from './punishments.service';

@Module({
  controllers: [PunishmentsController, PlayerModerationController, PluginPunishmentsController],
  providers: [PunishmentsService, PunishmentEditingService, PluginAuthGuard],
  exports: [PunishmentsService, PunishmentEditingService],
})
export class PunishmentsModule {}
