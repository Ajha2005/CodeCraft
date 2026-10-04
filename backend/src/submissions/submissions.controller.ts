import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { CreateSubmissionDto } from './dto/create-submission.dto';
import { SubmissionsService } from './submissions.service';

// Demo (guest) sessions cannot reach POST here: the global AccessGuard only lets
// them read, and they have no submissions to read, so the GETs answer empty / 404.
@Controller('submissions')
export class SubmissionsController {
  constructor(private readonly submissionsService: SubmissionsService) {}

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateSubmissionDto) {
    return this.submissionsService.createSubmission(user.userId, dto);
  }

  /** Best verdict per problem for the caller. */
  @Get('me/status')
  async myStatus(@CurrentUser() user: AuthUser) {
    return user.isGuest ? {} : this.submissionsService.getStatusByProblem(user.userId);
  }

  @Get(':id')
  getOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.submissionsService.getSubmission(user.userId, id);
  }
}
