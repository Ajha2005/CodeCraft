import { Body, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateSubmissionDto } from './dto/create-submission.dto';
import { SubmissionsService } from './submissions.service';

// Everything here belongs to the signed-in player: who is submitting comes from
// their token, never from the request body, so nobody can submit as (or read the
// code of) somebody else. Players without an account use the /demo endpoints.
@UseGuards(JwtAuthGuard)
@Controller('submissions')
export class SubmissionsController {
  constructor(private readonly submissionsService: SubmissionsService) {}

  @Post()
  async create(@Req() req: any, @Body() dto: CreateSubmissionDto) {
    return this.submissionsService.createSubmission(req.user.userId, dto.problemId, dto.code, dto.language);
  }

  @Get('status/:userId')
  async getStatusByProblem(@Req() req: any, @Param('userId') userId: string) {
    if (userId !== req.user.userId) throw new ForbiddenException('You can only read your own progress');
    return this.submissionsService.getStatusByProblem(userId);
  }

  @Get(':id')
  async getOne(@Req() req: any, @Param('id') id: string) {
    const submission = await this.submissionsService.getSubmission(id);
    // A submission that is not yours looks exactly like one that does not exist.
    if (!submission || submission.userId !== req.user.userId) throw new NotFoundException('Submission not found');
    return submission;
  }
}
