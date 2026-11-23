import { Module } from '@nestjs/common';
import { BootstrapService } from './bootstrap.service';
import { RolesController } from './roles.controller';

@Module({ controllers: [RolesController], providers: [BootstrapService] })
export class RbacModule {}
