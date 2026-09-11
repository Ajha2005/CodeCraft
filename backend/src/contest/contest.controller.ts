import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ContestService } from './contest.service';
import { CreateChallengeDto } from './dto/create-challenge.dto';
import { SubmitContestSolutionDto } from './dto/submit-contest-solution.dto';

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
    return this.contestService.listIncoming(req.user.userId);
  }

  @Get('outgoing')
  listOutgoing(@Req() req: any) {
    return this.contestService.listOutgoing(req.user.userId);
  }

  @Get('active')
  listActive(@Req() req: any) {
    return this.contestService.listActive(req.user.userId);
  }

  @Get(':id')
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
