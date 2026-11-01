import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { JudgeService } from '../judge/judge.service';
import { ScoringService } from '../scoring/scoring.service';
import { LeaderboardRedisService } from '../common/redis/leaderboard-redis.service';
import { TerritoryGateway } from '../territory/territory.gateway';
import { ContestService } from '../contest/contest.service';
import { lookupUserColor } from '../common/color/color.util';
import { campusDay } from '../common/date/day.util';
import { DAILY_LIMIT } from '../scoring/scoring.constants';

// Cell allocation reads and writes the same two tables whether it runs on the
// plain client or inside the award's transaction.
type CellDb = Pick<PrismaService, 'territoryCell' | 'territoryCellOwnership'>;

interface ClaimedCell {
  id: string;
  territoryId: string;
  row: number;
  col: number;
}

const TIER_ORDER = ['OUTPOST', 'SETTLEMENT', 'STRONGHOLD', 'CITADEL'];

/** The tier itself, then the others by how near they are, lower tiers before higher ones. */
function tiersByCloseness(tier: string): string[] {
  const at = Math.max(0, TIER_ORDER.indexOf(tier));
  return [...TIER_ORDER].sort((a, b) => {
    const da = Math.abs(TIER_ORDER.indexOf(a) - at);
    const db = Math.abs(TIER_ORDER.indexOf(b) - at);
    return da - db || TIER_ORDER.indexOf(a) - TIER_ORDER.indexOf(b);
  });
}

@Processor('submissions', { stalledInterval: 300000 })
export class SubmissionsProcessor extends WorkerHost {
  private readonly logger = new Logger(SubmissionsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly judgeService: JudgeService,
    private readonly scoringService: ScoringService,
    private readonly leaderboardRedis: LeaderboardRedisService,
    private readonly territoryGateway: TerritoryGateway,
    private readonly contestService: ContestService,
  ) {
    super();
  }

  async process(job: Job): Promise<any> {
    const {
      submissionId,
      code,
      testCases,
      language,
      userId,
      problemId,
      contestId,
    } = job.data;

    const judgeResult = await this.judgeService.runAllTestCases(
      code,
      testCases,
      language,
    );

    // A demo run has no account behind it: nothing is saved and no cell is
    // awarded. The result stays on the job for the demo endpoint to read.
    if (job.data.demo) return judgeResult;

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

    const today = campusDay();

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

    const tier = this.scoringService.getTerritoryTier(score.totalScore);

    // The score, the day's count and the cell are one award: they are saved
    // together or not at all. Saved one by one, a failure part-way (or a worker
    // dying) left a player with the points but no cell, and the retry was then
    // turned away as ALREADY_SOLVED, so the cell was never made up.
    const cell = await this.prisma.$transaction(async (tx) => {
      await tx.performanceScore.create({
        data: {
          submissionId,
          difficultyWeight: score.difficultyWeight,
          correctness: score.correctness,
          attemptsPenalty: score.attemptsPenalty,
          timeEfficiency: score.timeEfficiency,
          totalScore: score.totalScore,
        },
      });

      await tx.dailyProgress.upsert({
        where: { userId_date: { userId, date: today } },
        create: { userId, date: today, qualifyingCount: 1 },
        update: { qualifyingCount: { increment: 1 } },
      });

      return this.allocateCell(tx, userId, tier, submissionId);
    });

    // Past this point the award is saved. What is left only tells other people
    // about it, so none of it may undo or hold back the award.
    if (cell) await this.broadcastCell(cell, userId);
    await this.refreshLeaderboard(userId);

    return { awarded: true, reason: null };
  }

  private async refreshLeaderboard(userId: string) {
    try {
      const userScoreAgg = await this.prisma.performanceScore.aggregate({
        where: { submission: { userId } },
        _sum: { totalScore: true },
      });
      const totalUserScore = userScoreAgg._sum.totalScore ?? 0;
      await this.leaderboardRedis.updateCollegeScore(userId, totalUserScore);
      this.territoryGateway.broadcastLeaderboardUpdate({
        userId,
        newScore: totalUserScore,
      });
    } catch (err) {
      this.logger.error(
        `Leaderboard update failed for user ${userId}; their solve is saved`,
        err as Error,
      );
    }
  }

  private isAdjacent(
    a: { row: number; col: number },
    b: { row: number; col: number },
  ) {
    return Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;
  }

  // Picks the one cell a correct solve earns and writes the ownership, but
  // announces nothing: the caller broadcasts once the write is committed.
  //
  // A solve only ever hands out ground nobody holds: it never takes a cell from
  // another player (cells change hands only through a duel both sides accepted),
  // so every player's cells are theirs alone. In order of preference:
  //   1. a free cell touching the cells the player already holds in this tier
  //   2. any other free cell in the zones they already hold
  //   3. any free cell in the tier
  //   4. when the tier is full, a free cell in the nearest other tier (lower
  //      tiers first), so the solve still earns ground
  // Returns null only when no cell on the whole map is free.
  private async allocateCell(
    db: CellDb,
    userId: string,
    tier: string,
    submissionId?: string,
  ): Promise<ClaimedCell | null> {
    const owned = await db.territoryCellOwnership.findMany({
      where: { userId, closedAt: null, cell: { territory: { tier } } },
      include: { cell: true },
    });
    const mine = owned.map((o) => o.cell);

    // Every cell of the zones they already hold, with its current owner.
    const nearby = mine.length
      ? await db.territoryCell.findMany({
          where: {
            territoryId: { in: [...new Set(mine.map((c) => c.territoryId))] },
          },
          include: { ownerships: { where: { closedAt: null } } },
          orderBy: [{ row: 'asc' }, { col: 'asc' }],
        })
      : [];

    const touchesMine = (cell: {
      territoryId: string;
      row: number;
      col: number;
    }) =>
      mine.some(
        (own) =>
          own.territoryId === cell.territoryId && this.isAdjacent(own, cell),
      );

    const freeNearby = nearby.filter((c) => c.ownerships.length === 0);
    const free = freeNearby.find(touchesMine) ?? freeNearby[0];
    if (free) return this.claimCell(db, userId, tier, free, submissionId);

    for (const candidate of tiersByCloseness(tier)) {
      const freeInTier = await db.territoryCell.findFirst({
        where: {
          territory: { tier: candidate },
          ownerships: { none: { closedAt: null } },
        },
        orderBy: [
          { territory: { name: 'asc' } },
          { row: 'asc' },
          { col: 'asc' },
        ],
      });
      if (freeInTier) {
        return this.claimCell(db, userId, candidate, freeInTier, submissionId);
      }
    }

    this.logger.error(
      `No free cell anywhere for user ${userId} (wanted ${tier}) — every cell is taken or seed data is missing.`,
    );
    return null;
  }

  private async claimCell(
    db: CellDb,
    userId: string,
    tier: string,
    cell: ClaimedCell,
    submissionId?: string,
  ): Promise<ClaimedCell> {
    await db.territoryCellOwnership.create({
      data: { cellId: cell.id, userId, sourceType: 'solve', submissionId, captured: false },
    });
    this.logger.log(
      `Assigned unclaimed ${tier} cell ${cell.id} (territory ${cell.territoryId}) to user ${userId}`,
    );
    return cell;
  }

  private async broadcastCell(
    cell: { id: string; territoryId: string; row: number; col: number },
    userId: string,
  ) {
    try {
      this.territoryGateway.broadcastCellUpdate({
        territoryId: cell.territoryId,
        cellId: cell.id,
        row: cell.row,
        col: cell.col,
        ownerId: userId,
        ownerColor: await lookupUserColor(this.prisma, userId),
      });
    } catch (err) {
      this.logger.error(
        `Could not announce cell ${cell.id} for user ${userId}; the cell is theirs regardless`,
        err as Error,
      );
    }
  }
}
