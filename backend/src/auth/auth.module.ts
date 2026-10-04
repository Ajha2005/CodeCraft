import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GoogleStrategy } from './google.strategy';
import { jwtModuleOptions } from './jwt.config';
import { JwtStrategy } from './jwt.strategy';
import { LoginCodeService } from './login-code.service';

@Module({
  imports: [
    PassportModule,
    // Async so the secret is read (and validated) when the app starts, not when this file is imported.
    JwtModule.registerAsync({ useFactory: () => jwtModuleOptions() }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, GoogleStrategy, LoginCodeService],
  // The WebSocket gateways verify tokens with the very same JwtService configuration.
  exports: [JwtModule, PassportModule],
})
export class AuthModule {}
