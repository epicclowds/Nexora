import { Global, Module } from '@nestjs/common';
import { PresetsController } from './presets.controller';
import { PresetsService } from './presets.service';
import { StaffPermissionsService } from './staff-permissions.service';

@Global()
@Module({ controllers: [PresetsController], providers: [PresetsService, StaffPermissionsService], exports: [PresetsService, StaffPermissionsService] })
export class PresetsModule {}
