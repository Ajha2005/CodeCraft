import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { JudgeService } from '../judge/judge.service';
import { ScoringService } from '../scoring/scoring.service';
import { LeaderboardRedisService } from '../common/redis/leaderboard-redis.service';
import { TerritoryGateway } from '../territory/territory.gateway';
import { getColorForUser } from '../common/color/color.util';

const DAILY_LIMIT = 6;

@Processor('submissions')
export class SubmissionsProcessor extends WorkerHost {
  private readonly logger = new Logger(SubmissionsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly judgeService: JudgeService,
    private readonly scoringService: ScoringService,
    private readonly leaderboardRedis: LeaderboardRedisService,
    private readonly territoryGateway: TerritoryGateway,
  ) {
    super();
  }

  async process(job: Job): Promise<any> {
    const { submissionId, code, testCases, language, userId, problemId } = job.data;

    const judgeResult = await this.judgeService.runAllTestCases(code, testCases, language);

    // Compute points-awarded outcome BEFORE writing anything to the submission row,
    // so verdict and pointsAwarded/noPointsReason always land in a single atomic
    // update. Writing them separately created a race: the frontend's poll stops
    // as soon as it sees verdict !== 'PENDING', so a poll landing between two
    // separate updates could see verdict: 'AC' with pointsAwarded still at its
    // default (false) and never poll again to pick up the corrected value.
    let pointsAwarded = false;
    let noPointsReason: string | null = null;

    if (judgeResult.verdict === 'AC') {
      try {
        const result = await this.handleAcceptedSubmission(submissionId, userId, problemId);
        pointsAwarded = result.awarded;
        noPointsReason = result.reason;
      } catch (err) {
        this.logger.error('handleAcceptedSubmission failed', err as Error);
      }
    }

    await this.prisma.submission.update({
      where: { id: submissionId },
      data: {
        verdict: judgeResult.verdict,
        totalPassed: judgeResult.totalPassed,
        totalTests: judgeResult.totalTests,
        pointsAwarded,
        noPointsReason,
      },
    });

    return judgeResult;
  }

  private async handleAcceptedSubmission(
    submissionId: string,
    userId: string,
    problemId: number,
  ): Promise<{ awarded: boolean; reason: string | null }> {
    // Prevent re-scoring/re-territory-assignment for a problem the user has
    // already earned credit for. This is distinct from the daily-limit check
    // below: this one is about not double-counting the same problem, not
    // about pacing how many distinct problems count per day.
    const alreadyScored = await this.prisma.performanceScore.findFirst({
      where: { submission: { userId, problemId } },
    });
    if (alreadyScored) {
      this.logger.log(
        `User ${userId} already has a score for problem ${problemId} — skipping re-award.`,
      );
      return { awarded: false, reason: 'ALREADY_SOLVED' };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const progress = await this.prisma.dailyProgress.findUnique({
      where: { userId_date: { userId, date: today } },
    });

    if (progress && progress.qualifyingCount >= DAILY_LIMIT) {
      return { awarded: false, reason: 'DAILY_LIMIT' };
    }

    const problem = await this.prisma.problem.findUnique({ where: { id: problemId } });
    if (!problem) return { awarded: false, reason: null };

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

    const userScoreAgg = await this.prisma.performanceScore.aggregate({
      where: { submission: { userId } },
      _sum: { totalScore: true },
    });
    const totalUserScore = userScoreAgg._sum.totalScore ?? 0;
    await this.leaderboardRedis.updateCollegeScore(userId, totalUserScore);
    this.territoryGateway.broadcastLeaderboardUpdate({ userId, newScore: totalUserScore });

    await this.prisma.dailyProgress.upsert({
      where: { userId_date: { userId, date: today } },
      create: { userId, date: today, qualifyingCount: 1 },
      update: { qualifyingCount: { increment: 1 } },
    });

    const tier = this.scoringService.getTerritoryTier(score.totalScore);
    await this.assignTerritory(userId, tier);

    return { awarded: true, reason: null };
  }

  private async assignTerritory(userId: string, tier: string) {
    // Prefer any unclaimed cell in any territory of this tier
    const unclaimedCell = await this.prisma.territoryCell.findFirst({
      where: {
        territory: { tier },
        ownerships: { none: { closedAt: null } },
      },
      include: { territory: true },
    });

    if (unclaimedCell) {
      await this.prisma.territoryCellOwnership.create({
        data: { cellId: unclaimedCell.id, userId, sourceType: 'solve' },
      });
      this.logger.log(
        `Assigned unclaimed ${tier} cell ${unclaimedCell.id} (territory ${unclaimedCell.territoryId}) to user ${userId}`,
      );
      this.territoryGateway.broadcastCellUpdate({
        territoryId: unclaimedCell.territoryId,
        cellId: unclaimedCell.id,
        row: unclaimedCell.row,
        col: unclaimedCell.col,
        ownerId: userId,
        ownerColor: getColorForUser(userId),
      });
      return;
    }

    // Nothing unclaimed anywhere in this tier — contest a cell owned by someone else.
    // Skip cells the user already owns themselves (no point re-capturing your own cell).
    const contested = await this.prisma.territoryCell.findFirst({
      where: {
        territory: { tier },
        ownerships: { some: { closedAt: null, NOT: { userId } } },
      },
      include: { territory: true, ownerships: { where: { closedAt: null } } },
    });

    if (!contested) {
      this.logger.error(`No contestable ${tier} cells exist — seed data missing or all cells self-owned.`);
      return;
    }

    const openOwnership = contested.ownerships[0];
    await this.prisma.territoryCellOwnership.update({
      where: { id: openOwnership.id },
      data: { closedAt: new Date() },
    });
    await this.prisma.territoryCellOwnership.create({
      data: { cellId: contested.id, userId, sourceType: 'solve' },
    });
    this.logger.log(
      `User ${userId} captured ${tier} cell ${contested.id} (territory ${contested.territoryId})`,
    );
    this.territoryGateway.broadcastCellUpdate({
      territoryId: contested.territoryId,
      cellId: contested.id,
      row: contested.row,
      col: contested.col,
      ownerId: userId,
      ownerColor: getColorForUser(userId),
    });
  }
}