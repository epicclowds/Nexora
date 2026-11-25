import { Global, Module } from '@nestjs/common';
import { UpdatesController } from './updates.controller';
import { UpdatesService } from './updates.service';

@Global()
@Module({ controllers: [UpdatesController], providers: [UpdatesService], exports: [UpdatesService] })
export class UpdatesModule {}
