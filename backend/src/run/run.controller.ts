import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { RunDto } from './run.dto';
import { RunService } from './run.service';

// Demo (guest) sessions: 10 runs a minute, counted per IP because anyone can mint
// guest tokens. Signed-in users: 30 a minute, counted per account.
const runLimit = (context: import('@nestjs/common').ExecutionContext) =>
  context.switchToHttp().getRequest<{ user?: AuthUser }>().user?.isGuest ? 10 : 30;

@Controller('run')
export class RunController {
  constructor(private readonly runService: RunService) {}

  /** The only POST besides /auth/guest that a demo session may make (see AccessGuard). */
  @Post()
  @HttpCode(200)
  @Throttle({ default: { limit: runLimit, ttl: 60_000 } })
  run(@CurrentUser() user: AuthUser, @Body() dto: RunDto) {
    return this.runService.runSamples(dto, user);
  }
}
