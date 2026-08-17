import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JudgeService } from '../judge/judge.service';

@Injectable()
export class SubmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly judgeService: JudgeService,
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

    const testCases = problem.testCases as { input: Record<string, any>; expected_output: any }[];
    const judgeResult = await this.judgeService.runAllTestCases(code, testCases);

    const updated = await this.prisma.submission.update({
      where: { id: submission.id },
      data: {
        verdict: judgeResult.verdict,
        totalPassed: judgeResult.totalPassed,
        totalTests: judgeResult.totalTests,
      },
    });

    return {
      submission: updated,
      results: judgeResult.results,
    };
  }

  async getSubmission(id: string) {
    return this.prisma.submission.findUnique({ where: { id } });
  }
}
