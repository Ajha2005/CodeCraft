import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { NoGuests } from '../auth/guest.decorators';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ContestService } from './contest.service';
import { CreateChallengeDto } from './dto/create-challenge.dto';
import { SubmitContestSolutionDto } from './dto/submit-contest-solution.dto';

// Duels are between real accounts. The global GuestPolicyGuard already stops a
// demo (guest) session from every POST here; the list endpoints answer "nothing"
// for it, and a single duel is closed to it.
@UseGuards(JwtAuthGuard)
@Controller('contests')
export class ContestController {
  constructor(private readonly contestService: ContestService) {}

  @Post('challenges')
  createChallenge(@Req() req: any, @Body() dto: CreateChallengeDto) {
    return this.contestService.createChallenge(req.user.userId, dto);
  }

  @Get('incoming')
  listIncoming(@Req() req: any) {
    return req.user.isGuest ? [] : this.contestService.listIncoming(req.user.userId);
  }

  @Get('outgoing')
  listOutgoing(@Req() req: any) {
    return req.user.isGuest ? [] : this.contestService.listOutgoing(req.user.userId);
  }

  @Get('active')
  listActive(@Req() req: any) {
    return req.user.isGuest ? [] : this.contestService.listActive(req.user.userId);
  }

  @Get(':id')
  @NoGuests()
  getContest(@Req() req: any, @Param('id') id: string) {
    return this.contestService.getContest(id, req.user.userId);
  }

  @Post(':id/accept')
  accept(@Req() req: any, @Param('id') id: string) {
    return this.contestService.accept(id, req.user.userId);
  }

  @Post(':id/decline')
  decline(@Req() req: any, @Param('id') id: string) {
    return this.contestService.decline(id, req.user.userId);
  }

  @Post(':id/submissions')
  submit(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: SubmitContestSolutionDto,
  ) {
    return this.contestService.submitSolution(id, req.user.userId, dto);
  }
}
