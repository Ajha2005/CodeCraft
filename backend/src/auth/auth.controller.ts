import { Body, Controller, Get, GoneException, HttpCode, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthUser } from './auth-user';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { ExchangeCodeDto } from './dto/exchange-code.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { GoogleAuthGuard } from './google-auth.guard';
import type { GoogleUser } from './google.strategy';
import { Public } from './public.decorator';

const frontendBaseUrl = () => (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /** Starts a read-only demo session. No credentials, no account, no database row. Limited per IP. */
  @Public()
  @Post('guest')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60 * 60 * 1000 } })
  guest() {
    return this.authService.issueGuestToken();
  }

  /** Accounts are created by Google sign-in only. Kept so old clients get a clear answer, not a 404. */
  @Public()
  @Post('signup')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  signup() {
    throw new GoneException('Sign-up is done with Google now. Use "Continue with Google" with your Thapar account.');
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  /** Trades the one-time code from the Google redirect for an access token (the token never travels in a URL). */
  @Public()
  @Post('exchange')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  exchange(@Body() dto: ExchangeCodeDto) {
    return this.authService.exchangeLoginCode(dto.code);
  }

  @Get('me')
  getProfile(@CurrentUser() user: AuthUser) {
    return this.authService.getProfile(user);
  }

  @Patch('settings')
  updateSettings(@CurrentUser() user: AuthUser, @Body() dto: UpdateSettingsDto) {
    return this.authService.updateSettings(user.userId, dto.flavorTextEnabled);
  }

  @Public()
  @UseGuards(GoogleAuthGuard)
  @Get('google')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  googleLogin() {
    // redirects to Google — this method body never runs
  }

  @Public()
  @UseGuards(GoogleAuthGuard)
  @Get('google/callback')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async googleCallback(@Req() req: Request & { googleUser?: GoogleUser; googleAuthFailureReason?: string }, @Res() res: Response) {
    const frontend = frontendBaseUrl();

    if (!req.googleUser) {
      const reason = req.googleAuthFailureReason === 'oauth_error' ? 'google_auth_failed' : 'domain_not_allowed';
      return res.redirect(`${frontend}/login?error=${reason}`);
    }

    try {
      const userId = await this.authService.findOrCreateGoogleUser(req.googleUser, req.ip);
      const code = await this.authService.issueLoginCode(userId);
      return res.redirect(`${frontend}/auth/callback?code=${encodeURIComponent(code)}`);
    } catch {
      return res.redirect(`${frontend}/login?error=google_auth_failed`);
    }
  }
}
