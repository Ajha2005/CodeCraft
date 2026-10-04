import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { JudgeService } from '../judge/judge.service';
import { ScoringService } from '../scoring/scoring.service';
import { LeaderboardRedisService } from '../common/redis/leaderboard-redis.service';
import { TerritoryGateway } from '../territory/territory.gateway';
import { ContestService } from '../contest/contest.service';
import { AuditLogService } from '../audit/audit.service';
import { getColorForUser } from '../common/color/color.util';

const DAILY_LIMIT = 6;

// How many submissions are judged at the same time. Each one is a sequence of
// runs on the code runner, which has its own (smaller) cap, so a high number
// here only makes more jobs wait inside the runner's queue.
const workerConcurrency = () => {
  const value = Number(process.env.SUBMISSION_WORKER_CONCURRENCY);
  return Number.isInteger(value) && value >= 1 && value <= 4 ? value : 2;
};

@Processor('submissions', { stalledInterval: 300000, concurrency: workerConcurrency() })
export class SubmissionsProcessor extends WorkerHost {
  private readonly logger = new Logger(SubmissionsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly judgeService: JudgeService,
    private readonly scoringService: ScoringService,
    private readonly leaderboardRedis: LeaderboardRedisService,
    private readonly territoryGateway: TerritoryGateway,
    private readonly contestService: ContestService,
    private readonly audit: AuditLogService,
  ) {
    super();
  }

  /**
   * The job only carries a submission id. The code, language, owner and the
   * problem's hidden test cases are read from Postgres here, so none of them
   * ever sit in Redis (which has no encryption in transit on the free plan).
   */
  async process(job: Job<{ submissionId: string }>): Promise<any> {
    const submission = await this.prisma.submission.findUnique({
      where: { id: job.data.submissionId },
      select: {
        id: true,
        userId: true,
        problemId: true,
        code: true,
        language: true,
        contestId: true,
        problem: { select: { testCases: true } },
      },
    });
    if (!submission) {
      this.logger.warn(`Submission ${job.data.submissionId} no longer exists, skipping its job`);
      return;
    }
    const { id: submissionId, userId, problemId, code, language, contestId } = submission;
    const testCases = submission.problem.testCases as { input: Record<string, any>; expected_output: any }[];

    const judgeResult = await this.judgeService.runAllTestCases(code, testCases, language);

    // Contest submissions never touch the daily-limit/territory-tier scoring
    // path below — winning a contest transfers the contested cell directly,
    // it's a different mechanism from solo territory acquisition.
    if (contestId) {
      await this.prisma.submission.update({
        where: { id: submissionId },
        data: {
          verdict: judgeResult.verdict,
          totalPassed: judgeResult.totalPassed,
          totalTests: judgeResult.totalTests,
        },
      });
      try {
        await this.contestService.handleSubmissionResult(
          contestId,
          userId,
          submissionId,
          judgeResult.verdict,
          judgeResult.totalPassed,
          judgeResult.totalTests,
        );
      } catch (err) {
        this.logger.error('handleSubmissionResult failed', err as Error);
      }
      return judgeResult;
    }

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
        const result = await this.handleAcceptedSubmission(
          submissionId,
          userId,
          problemId,
        );
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

    const problem = await this.prisma.problem.findUnique({
      where: { id: problemId },
    });
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
    this.territoryGateway.broadcastLeaderboardUpdate();

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
    // If the user already holds cells in this tier, grow their territory
    // outward from those cells instead of handing them an unrelated one.
    const ownedCells = await this.prisma.territoryCellOwnership.findMany({
      where: { userId, closedAt: null, cell: { territory: { tier }, retiredAt: null } },
      include: { cell: true },
    });

    if (ownedCells.length > 0) {
      const grown = await this.tryGrowTerritory(
        userId,
        tier,
        ownedCells.map((o) => o.cell),
      );
      if (grown) return;
    }

    await this.assignAnyCellInTier(userId, tier);
  }

  private isAdjacent(
    a: { row: number; col: number },
    b: { row: number; col: number },
  ) {
    return Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;
  }

  // Tries to extend the user's existing footprint in this tier by one cell,
  // touching a cell they already own. Prefers an unclaimed neighbor; if every
  // neighbor is already someone else's, captures one instead. Returns false
  // when no owned cell has any neighboring cell at all, so the caller can
  // fall back to the tier-wide assignment.
  private async tryGrowTerritory(
    userId: string,
    tier: string,
    ownedCells: { territoryId: string; row: number; col: number }[],
  ): Promise<boolean> {
    const territoryIds = [...new Set(ownedCells.map((c) => c.territoryId))];

    const candidates = await this.prisma.territoryCell.findMany({
      where: { territoryId: { in: territoryIds }, retiredAt: null },
      include: { ownerships: { where: { closedAt: null } } },
    });

    const isNeighborOfOwned = (cell: {
      territoryId: string;
      row: number;
      col: number;
    }) =>
      ownedCells.some(
        (owned) =>
          owned.territoryId === cell.territoryId &&
          this.isAdjacent(owned, cell),
      );

    const unclaimedNeighbor = candidates.find(
      (cell) => cell.ownerships.length === 0 && isNeighborOfOwned(cell),
    );
    if (unclaimedNeighbor) {
      await this.claimCell(userId, tier, unclaimedNeighbor);
      return true;
    }

    // Cells tied up in a pending or active duel are off limits to solo play.
    const locked = new Set(await this.contestService.lockedCellIds());
    const contestedNeighbor = candidates.find(
      (cell) =>
        isNeighborOfOwned(cell) &&
        !locked.has(cell.id) &&
        cell.ownerships.length > 0 &&
        cell.ownerships[0].userId !== userId,
    );
    if (contestedNeighbor) {
      await this.captureCell(
        userId,
        tier,
        contestedNeighbor,
        contestedNeighbor.ownerships[0].id,
        contestedNeighbor.ownerships[0].userId,
      );
      return true;
    }

    return false;
  }

  // Original tier-wide behavior: any unclaimed cell in the tier, else contest
  // a cell someone else holds. Used when the user has no foothold yet in this
  // tier, or their existing cells have no free/contestable neighbor left.
  private async assignAnyCellInTier(userId: string, tier: string) {
    const unclaimedCell = await this.prisma.territoryCell.findFirst({
      where: {
        territory: { tier },
        retiredAt: null,
        ownerships: { none: { closedAt: null } },
      },
    });

    if (unclaimedCell) {
      await this.claimCell(userId, tier, unclaimedCell);
      return;
    }

    // Nothing unclaimed anywhere in this tier — contest a cell owned by someone else.
    // Skip cells the user already owns themselves (no point re-capturing your own cell)
    // and cells tied up in a pending or active duel.
    const contested = await this.prisma.territoryCell.findFirst({
      where: {
        territory: { tier },
        retiredAt: null,
        id: { notIn: await this.contestService.lockedCellIds() },
        ownerships: { some: { closedAt: null, NOT: { userId } } },
      },
      include: { ownerships: { where: { closedAt: null } } },
    });

    if (!contested) {
      this.logger.error(
        `No contestable ${tier} cells exist — seed data missing or all cells self-owned.`,
      );
      return;
    }

    await this.captureCell(
      userId,
      tier,
      contested,
      contested.ownerships[0].id,
      contested.ownerships[0].userId,
    );
  }

  private async claimCell(
    userId: string,
    tier: string,
    cell: { id: string; territoryId: string; row: number; col: number },
  ) {
    const ownership = await this.prisma.territoryCellOwnership.create({
      data: { cellId: cell.id, userId, sourceType: 'solve' },
      include: { user: { select: { username: true } } },
    });
    this.logger.log(
      `Assigned unclaimed ${tier} cell ${cell.id} (territory ${cell.territoryId}) to user ${userId}`,
    );
    this.broadcastCell(cell, userId, ownership.user.username);
  }

  private async captureCell(
    userId: string,
    tier: string,
    cell: { id: string; territoryId: string; row: number; col: number },
    openOwnershipId: string,
    previousOwnerId?: string,
  ) {
    await this.prisma.territoryCellOwnership.update({
      where: { id: openOwnershipId },
      data: { closedAt: new Date() },
    });
    const ownership = await this.prisma.territoryCellOwnership.create({
      data: { cellId: cell.id, userId, sourceType: 'solve' },
      include: { user: { select: { username: true } } },
    });
    this.logger.log(
      `User ${userId} captured ${tier} cell ${cell.id} (territory ${cell.territoryId})`,
    );
    await this.audit.record({
      action: 'territory.transferred',
      actorType: 'USER',
      actorId: userId,
      targetType: 'cell',
      targetId: cell.id,
      reason: 'Captured by solving a problem',
      metadata: { sourceType: 'solve', tier, fromUserId: previousOwnerId ?? null, toUserId: userId },
    });
    this.broadcastCell(cell, userId, ownership.user.username);
  }

  private broadcastCell(
    cell: { id: string; territoryId: string; row: number; col: number },
    userId: string,
    username: string,
  ) {
    // The gateway tells each connected client whether the cell is theirs; the owner's id stays on the server.
    this.territoryGateway.broadcastCellUpdate({
      territoryId: cell.territoryId,
      cellId: cell.id,
      row: cell.row,
      col: cell.col,
      ownerUserId: userId,
      ownerUsername: username,
      ownerColor: getColorForUser(userId),
    });
  }
}
