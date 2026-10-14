import {
  Body,
  Controller,
  ExecutionContext,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { GuestCanWrite } from '../auth/guest.decorators';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AppThrottlerGuard } from '../common/guards/app-throttler.guard';
import { RunDto } from './run.dto';
import { RunService } from './run.service';

// Demo (guest) sessions: 10 runs a minute, counted per IP because anyone can mint
// guest tokens. Signed-in users: 30 a minute, counted per account.
const runLimit = (context: ExecutionContext) =>
  context.switchToHttp().getRequest<{ user?: AuthUser }>().user?.isGuest
    ? 10
    : 30;

@Controller('run')
@UseGuards(JwtAuthGuard, AppThrottlerGuard)
export class RunController {
  constructor(private readonly runService: RunService) {}

  /** Besides starting a demo, the only write a demo session may make (see GuestPolicyGuard). */
  @Post()
  @HttpCode(200)
  @GuestCanWrite()
  @Throttle({ default: { limit: runLimit, ttl: 60_000 } })
  run(@CurrentUser() user: AuthUser, @Body() dto: RunDto) {
    return this.runService.runSamples(dto, user);
  }
}
