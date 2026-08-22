import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { JudgeService } from '../judge/judge.service';
import { ScoringService } from '../scoring/scoring.service';

const DAILY_LIMIT = 6;

@Processor('submissions')
export class SubmissionsProcessor extends WorkerHost {
  private readonly logger = new Logger(SubmissionsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly judgeService: JudgeService,
    private readonly scoringService: ScoringService,
  ) {
    super();
  }

  async process(job: Job): Promise<any> {
    const { submissionId, code, testCases, language, userId, problemId } = job.data;

    const judgeResult = await this.judgeService.runAllTestCases(code, testCases, language);

    await this.prisma.submission.update({
      where: { id: submissionId },
      data: {
        verdict: judgeResult.verdict,
        totalPassed: judgeResult.totalPassed,
        totalTests: judgeResult.totalTests,
      },
    });

    if (judgeResult.verdict === 'AC') {
      try {
        await this.handleAcceptedSubmission(submissionId, userId, problemId);
      } catch (err) {
        this.logger.error('handleAcceptedSubmission failed', err as Error);
      }
    }

    return judgeResult;
  }

  private async handleAcceptedSubmission(
    submissionId: string,
    userId: string,
    problemId: number,
  ) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const progress = await this.prisma.dailyProgress.findUnique({
      where: { userId_date: { userId, date: today } },
    });

    if (progress && progress.qualifyingCount >= DAILY_LIMIT) {
      return;
    }

    const problem = await this.prisma.problem.findUnique({ where: { id: problemId } });
    if (!problem) return;

    const attempts = await this.prisma.submission.count({
      where: { userId, problemId },
    });

    const score = this.scoringService.computeScore({
      difficultyLevel: problem.difficultyLevel,
      attempts,
    });

    await this.prisma.performanceScore.create({
      data: {
        submissionId,
        difficultyWeight: score.difficultyWeight,
        correctness: score.correctness,
        attemptsPenalty: score.attemptsPenalty,
        timeEfficiency: score.timeEfficiency,
        totalScore: score.totalScore,
      },
    });

    await this.prisma.dailyProgress.upsert({
      where: { userId_date: { userId, date: today } },
      create: { userId, date: today, qualifyingCount: 1 },
      update: { qualifyingCount: { increment: 1 } },
    });

    const tier = this.scoringService.getTerritoryTier(score.totalScore);

    const territory = await this.prisma.territory.create({
      data: { name: `Territory-${Date.now()}`, tier, baseValue: score.totalScore },
    });

    await this.prisma.territoryOwnership.create({
      data: { territoryId: territory.id, userId, sourceType: 'solve' },
    });
  }
}
