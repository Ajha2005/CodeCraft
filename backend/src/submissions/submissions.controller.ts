import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { SubmissionsService } from './submissions.service';

@Controller('submissions')
export class SubmissionsController {
  constructor(private readonly submissionsService: SubmissionsService) {}

  @Post()
  async create(
    @Body('userId') userId: string,
    @Body('problemId') problemId: number,
    @Body('code') code: string,
    @Body('language') language: string,
  ) {
    return this.submissionsService.createSubmission(userId, problemId, code, language);
  }

  @Get(':id')
  async getOne(@Param('id') id: string) {
    return this.submissionsService.getSubmission(id);
  }

  @Get('status/:userId')
  async getStatusByProblem(@Param('userId') userId: string) {
    return this.submissionsService.getStatusByProblem(userId);
  }
}
