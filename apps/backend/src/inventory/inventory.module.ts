import { Module } from '@nestjs/common';
import { PluginAuthGuard } from '../plugin-api/plugin-auth.guard';
import { InventoryController, PluginInventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

@Module({ controllers: [InventoryController, PluginInventoryController], providers: [InventoryService, PluginAuthGuard] })
export class InventoryModule {}
