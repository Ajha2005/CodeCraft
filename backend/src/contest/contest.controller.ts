import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { NoGuests } from '../auth/public.decorator';
import { ContestService } from './contest.service';
import { CreateChallengeDto } from './dto/create-challenge.dto';
import { SubmitContestSolutionDto } from './dto/submit-contest-solution.dto';

// Duels are between real accounts. The global AccessGuard already stops demo
// (guest) sessions from every POST; the list endpoints answer "nothing" for them
// (so the navbar's polling stays quiet) and a single duel is a 403.
@Controller('contests')
export class ContestController {
  constructor(private readonly contestService: ContestService) {}

  @Post('challenges')
  @Throttle({ default: { limit: 10, ttl: 60 * 60 * 1000 } })
  createChallenge(@CurrentUser() user: AuthUser, @Body() dto: CreateChallengeDto) {
    return this.contestService.createChallenge(user.userId, dto);
  }

  @Get('incoming')
  listIncoming(@CurrentUser() user: AuthUser) {
    return user.isGuest ? [] : this.contestService.listIncoming(user.userId);
  }

  @Get('outgoing')
  listOutgoing(@CurrentUser() user: AuthUser) {
    return user.isGuest ? [] : this.contestService.listOutgoing(user.userId);
  }

  @Get('active')
  listActive(@CurrentUser() user: AuthUser) {
    return user.isGuest ? [] : this.contestService.listActive(user.userId);
  }

  @NoGuests()
  @Get(':id')
  getContest(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.contestService.getContest(id, user.userId);
  }

  @Post(':id/accept')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  accept(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.contestService.accept(id, user.userId);
  }

  @Post(':id/decline')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  decline(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.contestService.decline(id, user.userId);
  }

  @Post(':id/submissions')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  submit(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SubmitContestSolutionDto) {
    return this.contestService.submitSolution(id, user.userId, dto);
  }
}
