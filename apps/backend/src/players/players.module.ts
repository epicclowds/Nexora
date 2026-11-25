import { Global, Module } from '@nestjs/common';
import { AccountSkinController } from './account-skin.controller';
import { GeoIpService } from './geoip.service';
import { PlayersController } from './players.controller';
import { SkinService } from './skin.service';

@Global()
@Module({ controllers: [PlayersController, AccountSkinController], providers: [SkinService, GeoIpService], exports: [SkinService, GeoIpService] })
export class PlayersModule {}
