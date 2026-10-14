import { Body, Controller, Post, Get, HttpCode, Patch, UseGuards, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AppThrottlerGuard } from '../common/guards/app-throttler.guard';
import type { AuthUser } from './auth-user';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { GuestCanWrite } from './guest.decorators';
import { JwtAuthGuard } from './jwt-auth.guard';
import { GoogleAuthGuard } from './google-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  /**
   * Starts a read-only demo session. No credentials, no account, no database row.
   * Limited per IP, but generously: a classroom or a demo day shares one campus
   * address, and a session lasts two hours.
   */
  @Post('guest')
  @HttpCode(200)
  @GuestCanWrite()
  @UseGuards(AppThrottlerGuard)
  @Throttle({ default: { limit: 100, ttl: 60 * 60 * 1000 } })
  guest() {
    return this.authService.issueGuestToken();
  }

  @Post('signup')
  signup(@Body() dto: SignupDto) {
    return this.authService.signup(dto);
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  getProfile(@Req() req: { user: AuthUser }) {
    return this.authService.getProfile(req.user); // never the password hash
  }

  @UseGuards(JwtAuthGuard)
  @Patch('settings')
  updateSettings(@Req() req: any, @Body('flavorTextEnabled') flavorTextEnabled: boolean) {
    return this.authService.updateSettings(req.user.userId, flavorTextEnabled);
  }

  @UseGuards(GoogleAuthGuard)
  @Get('google')
  googleLogin() {
    // redirects to Google — this method body never runs
  }

  @UseGuards(GoogleAuthGuard)
  @Get('google/callback')
  async googleCallback(@Req() req: any, @Res() res: Response) {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

    if (!req.user) {
      const reason = req.googleAuthFailureReason === 'oauth_error' ? 'google_auth_failed' : 'domain_not_allowed';
      return res.redirect(`${frontendUrl}/login?error=${reason}`);
    }

    const { accessToken } = await this.authService.loginWithGoogle(req.user);
    res.redirect(`${frontendUrl}/auth/callback?token=${accessToken}`);
  }
}