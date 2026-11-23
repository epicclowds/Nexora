import { Module } from '@nestjs/common';
import { PluginRegistrationController, ServersController } from './servers.controller';
import { ServersService } from './servers.service';

@Module({ controllers: [ServersController, PluginRegistrationController], providers: [ServersService], exports: [ServersService] })
export class ServersModule {}
