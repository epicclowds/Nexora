import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LinkingService } from './linking.service';
import { AccountLinkController, LuckPermsController, PluginLuckPermsController, StaffAccountsController } from './luckperms.controller';
import { LuckPermsService } from './luckperms.service';
import { RankDisplayController, RankIconController } from './rank-display.controller';
import { RankDisplayService } from './rank-display.service';

@Global()
@Module({
  imports: [AuthModule],
  controllers: [LuckPermsController, AccountLinkController, StaffAccountsController, PluginLuckPermsController, RankDisplayController, RankIconController],
  providers: [LuckPermsService, LinkingService, RankDisplayService],
  exports: [LuckPermsService, LinkingService, RankDisplayService],
})
export class LuckPermsModule {}
