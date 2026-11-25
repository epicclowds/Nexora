import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LinkingService } from './linking.service';
import { AccountLinkController, LuckPermsController, PluginLuckPermsController, StaffAccountsController } from './luckperms.controller';
import { LuckPermsService } from './luckperms.service';

@Global()
@Module({
  imports: [AuthModule],
  controllers: [LuckPermsController, AccountLinkController, StaffAccountsController, PluginLuckPermsController],
  providers: [LuckPermsService, LinkingService],
  exports: [LuckPermsService, LinkingService],
})
export class LuckPermsModule {}
