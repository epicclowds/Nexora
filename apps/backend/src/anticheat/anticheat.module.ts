import { Module } from '@nestjs/common';
import { PluginAuthGuard } from '../plugin-api/plugin-auth.guard';
import { PunishmentsModule } from '../punishments/punishments.module';
import { AntiCheatController, PluginAntiCheatController } from './anticheat.controller';
import { AntiCheatService } from './anticheat.service';

@Module({ imports: [PunishmentsModule], controllers: [AntiCheatController, PluginAntiCheatController], providers: [AntiCheatService, PluginAuthGuard] })
export class AntiCheatModule {}
