import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SubmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('submissions') private readonly submissionsQueue: Queue,
  ) {}

  async createSubmission(userId: string, problemId: number, code: string, language: string) {
    const problem = await this.prisma.problem.findUnique({
      where: { id: problemId },
    });
    if (!problem) {
      throw new Error('Problem not found');
    }
    const submission = await this.prisma.submission.create({
      data: {
        userId,
        problemId,
        code,
        language,
        verdict: 'PENDING',
      },
    });
    await this.submissionsQueue.add('judge', {
      submissionId: submission.id,
      code,
      language,
      testCases: problem.testCases,
      userId,
      problemId,
    });
    return submission;
  }

  async getSubmission(id: string) {
    return this.prisma.submission.findUnique({ where: { id } });
  }
}
