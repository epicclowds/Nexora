import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AppConfig } from '../config/app-config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PermissionsGuard, SessionGuard } from './guards';
import { PasswordService } from './password.service';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        secret: config.env.JWT_SECRET,
        signOptions: { algorithm: 'HS256', issuer: 'mnm-backend' },
        verifyOptions: { algorithms: ['HS256'], issuer: 'mnm-backend' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, SessionGuard, PermissionsGuard],
  exports: [AuthService, PasswordService, SessionGuard, PermissionsGuard],
})
export class AuthModule {}
