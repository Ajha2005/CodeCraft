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

  /**
   * Best verdict per problem for a user — 'AC' beats any non-AC verdict,
   * which beats never having submitted at all. Powers the "uncharted
   * territory" vs "you've been here before" hover copy on the problem list.
   */
  async getStatusByProblem(userId: string): Promise<Record<number, 'AC' | 'ATTEMPTED'>> {
    const submissions = await this.prisma.submission.findMany({
      where: { userId, verdict: { not: 'PENDING' } },
      select: { problemId: true, verdict: true },
    });

    const status: Record<number, 'AC' | 'ATTEMPTED'> = {};
    for (const s of submissions) {
      if (s.verdict === 'AC') {
        status[s.problemId] = 'AC';
      } else if (status[s.problemId] !== 'AC') {
        status[s.problemId] = 'ATTEMPTED';
      }
    }
    return status;
  }
}
