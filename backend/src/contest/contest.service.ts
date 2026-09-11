import {
  Injectable,
  Inject,
  forwardRef,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { ProblemsService } from '../problems/problems.service';
import { TerritoryGateway } from '../territory/territory.gateway';
import { ContestGateway } from './contest.gateway';
import { getColorForUser } from '../common/color/color.util';
import { CreateChallengeDto } from './dto/create-challenge.dto';
import { SubmitContestSolutionDto } from './dto/submit-contest-solution.dto';

// Maps a contested cell's territory tier to the difficulty of problem used
// to fight over it — reuses the same tiers ScoringService.getTerritoryTier
// produces, so a CITADEL cell (only reachable by solving Hard problems well)
// is defended with a Hard problem, not an Easy one.
const DIFFICULTY_BY_TIER: Record<string, string> = {
  OUTPOST: 'Easy',
  SETTLEMENT: 'Easy',
  STRONGHOLD: 'Medium',
  CITADEL: 'Hard',
};

const DEFAULT_DURATION_SECONDS = 600;
const PENDING_EXPIRY_MS = 5 * 60 * 1000;

interface DisplayUser {
  id: string;
  name: string | null;
  email: string;
}

@Injectable()
export class ContestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly problemsService: ProblemsService,
    private readonly territoryGateway: TerritoryGateway,
    @Inject(forwardRef(() => ContestGateway))
    private readonly contestGateway: ContestGateway,
    @InjectQueue('submissions') private readonly submissionsQueue: Queue,
    @InjectQueue('contest-timeout') private readonly contestTimeoutQueue: Queue,
  ) {}

  // ---------- Challenge lifecycle ----------

  async createChallenge(challengerId: string, dto: CreateChallengeDto) {
    const cell = await this.prisma.territoryCell.findUnique({
      where: { id: dto.cellId },
      include: { ownerships: { where: { closedAt: null } } },
    });
    if (!cell) throw new NotFoundException('Territory cell not found');

    const currentOwnership = cell.ownerships[0];
    if (!currentOwnership) {
      throw new BadRequestException(
        'This cell is unclaimed — nothing to contest. Solve a problem to claim it instead.',
      );
    }
    const defenderId = currentOwnership.userId;
    if (defenderId === challengerId) {
      throw new BadRequestException('You already hold this cell');
    }

    const existing = await this.prisma.contest.findFirst({
      where: { cellId: dto.cellId, status: { in: ['PENDING', 'ACTIVE'] } },
    });
    if (existing) {
      throw new ConflictException(
        'This cell already has a pending or active contest',
      );
    }

    let problemId = dto.problemId;
    if (problemId) {
      const problem = await this.prisma.problem.findUnique({
        where: { id: problemId },
      });
      if (!problem)
        throw new NotFoundException(`Problem ${problemId} not found`);
    } else {
      problemId = await this.pickProblemForCell(dto.cellId);
    }

    const contest = await this.prisma.contest.create({
      data: {
        cellId: dto.cellId,
        problemId,
        challengerId,
        defenderId,
        durationSeconds: dto.durationSeconds ?? DEFAULT_DURATION_SECONDS,
      },
    });

    // Auto-expire if the defender never responds, so a cell doesn't stay
    // permanently un-challengeable behind a forgotten invite.
    await this.contestTimeoutQueue.add(
      'expire-pending',
      { contestId: contest.id },
      { delay: PENDING_EXPIRY_MS },
    );

    this.contestGateway.notifyUser(defenderId, 'challenge:received', {
      contestId: contest.id,
    });

    return this.getContest(contest.id, challengerId);
  }

  async listIncoming(userId: string) {
    const contests = await this.prisma.contest.findMany({
      where: { defenderId: userId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      include: this.summaryInclude(),
    });
    return contests.map((c) => this.toSummaryDto(c));
  }

  async listOutgoing(userId: string) {
    const contests = await this.prisma.contest.findMany({
      where: { challengerId: userId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      include: this.summaryInclude(),
    });
    return contests.map((c) => this.toSummaryDto(c));
  }

  /** PENDING or ACTIVE contests the caller is part of — for resuming on page reload. */
  async listActive(userId: string) {
    const contests = await this.prisma.contest.findMany({
      where: {
        status: { in: ['PENDING', 'ACTIVE'] },
        OR: [{ challengerId: userId }, { defenderId: userId }],
      },
      orderBy: { createdAt: 'desc' },
      include: this.summaryInclude(),
    });
    return contests.map((c) => this.toSummaryDto(c));
  }

  async getContest(id: string, userId: string) {
    const contest = await this.prisma.contest.findUnique({
      where: { id },
      include: {
        cell: { include: { territory: true } },
        challenger: { select: { id: true, name: true, email: true } },
        defender: { select: { id: true, name: true, email: true } },
        participants: true,
      },
    });
    if (!contest) throw new NotFoundException('Contest not found');
    if (contest.challengerId !== userId && contest.defenderId !== userId) {
      throw new ForbiddenException('Not a participant in this contest');
    }

    const problem = await this.problemsService.findOne(contest.problemId);

    return {
      id: contest.id,
      status: contest.status,
      cell: {
        id: contest.cell.id,
        row: contest.cell.row,
        col: contest.cell.col,
        territoryId: contest.cell.territoryId,
        territoryName: contest.cell.territory.name,
        tier: contest.cell.territory.tier,
      },
      problem,
      challenger: this.displayUser(contest.challenger),
      defender: this.displayUser(contest.defender),
      durationSeconds: contest.durationSeconds,
      startedAt: contest.startedAt,
      endedAt: contest.endedAt,
      winnerId: contest.winnerId,
      endReason: contest.endReason,
      participants: contest.participants.map((p) => ({
        userId: p.userId,
        verdict: p.verdict,
        totalPassed: p.totalPassed,
        totalTests: p.totalTests,
        solvedAt: p.solvedAt,
        connected: p.connected,
      })),
    };
  }

  async accept(id: string, userId: string) {
    const contest = await this.prisma.contest.findUnique({ where: { id } });
    if (!contest) throw new NotFoundException('Contest not found');
    if (contest.defenderId !== userId) {
      throw new ForbiddenException(
        'Only the defender can accept this challenge',
      );
    }
    if (contest.status !== 'PENDING') {
      throw new ConflictException(
        `Contest is ${contest.status.toLowerCase()}, not pending`,
      );
    }

    const now = new Date();
    const updated = await this.prisma.contest.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'ACTIVE', respondedAt: now, startedAt: now },
    });
    if (updated.count === 0) {
      throw new ConflictException('Challenge was already responded to');
    }

    await this.prisma.contestParticipant.createMany({
      data: [
        { contestId: id, userId: contest.challengerId },
        { contestId: id, userId: contest.defenderId },
      ],
    });

    await this.contestTimeoutQueue.add(
      'resolve-timeout',
      { contestId: id },
      { delay: contest.durationSeconds * 1000 },
    );

    this.contestGateway.notifyUser(contest.challengerId, 'challenge:accepted', {
      contestId: id,
    });
    this.contestGateway.broadcastToContest(id, 'contest:started', {
      contestId: id,
      startedAt: now.toISOString(),
      durationSeconds: contest.durationSeconds,
    });

    return this.getContest(id, userId);
  }

  async decline(id: string, userId: string) {
    const contest = await this.prisma.contest.findUnique({ where: { id } });
    if (!contest) throw new NotFoundException('Contest not found');
    if (contest.defenderId !== userId) {
      throw new ForbiddenException(
        'Only the defender can decline this challenge',
      );
    }

    const updated = await this.prisma.contest.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'DECLINED', respondedAt: new Date() },
    });
    if (updated.count === 0) {
      throw new ConflictException('Challenge was already responded to');
    }

    this.contestGateway.notifyUser(contest.challengerId, 'challenge:declined', {
      contestId: id,
    });
    return { id, status: 'DECLINED' };
  }

  // ---------- Live match ----------

  async submitSolution(
    contestId: string,
    userId: string,
    dto: SubmitContestSolutionDto,
  ) {
    const contest = await this.prisma.contest.findUnique({
      where: { id: contestId },
    });
    if (!contest) throw new NotFoundException('Contest not found');
    if (contest.challengerId !== userId && contest.defenderId !== userId) {
      throw new ForbiddenException('Not a participant in this contest');
    }
    if (contest.status !== 'ACTIVE') {
      throw new ConflictException(
        `Contest is ${contest.status.toLowerCase()}, not active`,
      );
    }
    if (contest.startedAt) {
      const deadline =
        contest.startedAt.getTime() + contest.durationSeconds * 1000;
      if (Date.now() > deadline) {
        throw new ConflictException('Contest time has expired');
      }
    }

    const problem = await this.prisma.problem.findUnique({
      where: { id: contest.problemId },
    });
    if (!problem) throw new NotFoundException('Problem not found');

    const submission = await this.prisma.submission.create({
      data: {
        userId,
        problemId: contest.problemId,
        code: dto.code,
        language: dto.language,
        verdict: 'PENDING',
        contestId,
      },
    });

    await this.submissionsQueue.add('judge', {
      submissionId: submission.id,
      code: dto.code,
      language: dto.language,
      testCases: problem.testCases,
      userId,
      problemId: contest.problemId,
      contestId,
    });

    return submission;
  }

  /** Called by SubmissionsProcessor once a contest submission's verdict comes back. */
  async handleSubmissionResult(
    contestId: string,
    userId: string,
    submissionId: string,
    verdict: string,
    totalPassed: number,
    totalTests: number,
  ) {
    const contest = await this.prisma.contest.findUnique({
      where: { id: contestId },
    });
    if (!contest || contest.status !== 'ACTIVE') {
      // Late result after the contest already resolved (opponent's AC,
      // timeout, or a forfeit) — nothing left to do with it.
      return;
    }

    const participant = await this.prisma.contestParticipant.findUnique({
      where: { contestId_userId: { contestId, userId } },
    });
    if (!participant) return;

    const isBetter =
      (verdict === 'AC' && participant.verdict !== 'AC') ||
      (participant.verdict !== 'AC' && totalPassed > participant.totalPassed);

    if (isBetter) {
      await this.prisma.contestParticipant.update({
        where: { id: participant.id },
        data: {
          bestSubmissionId: submissionId,
          verdict,
          totalPassed,
          totalTests,
          solvedAt: verdict === 'AC' ? new Date() : participant.solvedAt,
        },
      });
    }

    this.contestGateway.broadcastToContest(
      contestId,
      'contest:submissionResult',
      {
        userId,
        verdict,
        totalPassed,
        totalTests,
        timestamp: new Date().toISOString(),
      },
    );

    if (verdict === 'AC') {
      // First correct AC wins outright — no need to wait for the opponent.
      await this.resolveContest(contestId, userId, 'AC');
    }
  }

  /** Fired by the delayed BullMQ job scheduled in accept(). */
  async resolveOnTimeout(contestId: string) {
    const contest = await this.prisma.contest.findUnique({
      where: { id: contestId },
      include: { participants: true },
    });
    if (!contest || contest.status !== 'ACTIVE') return;

    const [a, b] = contest.participants;
    let winnerId: string | null = null;
    if (a && b) {
      if (a.totalPassed > b.totalPassed) winnerId = a.userId;
      else if (b.totalPassed > a.totalPassed) winnerId = b.userId;
      // equal (including 0-0) stays a draw
    } else if (a) {
      winnerId = a.totalPassed > 0 ? a.userId : null;
    } else if (b) {
      winnerId = b.totalPassed > 0 ? b.userId : null;
    }

    await this.resolveContest(
      contestId,
      winnerId,
      winnerId ? 'TIMEOUT' : 'DRAW',
    );
  }

  /** Fired by the ContestGateway after a disconnect's grace period expires. */
  async forfeit(contestId: string, disconnectedUserId: string) {
    const contest = await this.prisma.contest.findUnique({
      where: { id: contestId },
    });
    if (!contest || contest.status !== 'ACTIVE') return;

    await this.prisma.contestParticipant.updateMany({
      where: { contestId, userId: disconnectedUserId },
      data: { forfeited: true },
    });

    const winnerId =
      disconnectedUserId === contest.challengerId
        ? contest.defenderId
        : contest.challengerId;
    await this.resolveContest(contestId, winnerId, 'FORFEIT');
  }

  /** Fired by the delayed BullMQ job scheduled in createChallenge(). */
  async expirePendingChallenge(contestId: string) {
    const updated = await this.prisma.contest.updateMany({
      where: { id: contestId, status: 'PENDING' },
      data: { status: 'EXPIRED', respondedAt: new Date() },
    });
    if (updated.count > 0) {
      const contest = await this.prisma.contest.findUnique({
        where: { id: contestId },
      });
      if (contest) {
        this.contestGateway.notifyUser(
          contest.challengerId,
          'challenge:expired',
          { contestId },
        );
      }
    }
  }

  // ---------- Internals ----------

  private async pickProblemForCell(cellId: string): Promise<number> {
    const cell = await this.prisma.territoryCell.findUnique({
      where: { id: cellId },
      include: { territory: true },
    });
    if (!cell) throw new NotFoundException('Territory cell not found');

    const difficulty = DIFFICULTY_BY_TIER[cell.territory.tier] ?? 'Easy';
    const candidates = await this.prisma.problem.findMany({
      where: { difficultyLevel: difficulty },
      select: { id: true },
    });
    if (candidates.length === 0) {
      throw new BadRequestException(
        `No ${difficulty} problems available to contest this cell`,
      );
    }
    return candidates[Math.floor(Math.random() * candidates.length)].id;
  }

  /**
   * Resolves an ACTIVE contest exactly once. The status='ACTIVE' guard on
   * the update makes this safe against the AC / timeout / forfeit paths all
   * racing to resolve the same contest — only the first one to land the
   * update actually transfers the cell or broadcasts the result.
   */
  private async resolveContest(
    contestId: string,
    winnerId: string | null,
    reason: string,
  ) {
    const now = new Date();
    const updated = await this.prisma.contest.updateMany({
      where: { id: contestId, status: 'ACTIVE' },
      data: { status: 'COMPLETED', winnerId, endReason: reason, endedAt: now },
    });
    if (updated.count === 0) return;

    const contest = await this.prisma.contest.findUnique({
      where: { id: contestId },
    });
    if (!contest) return;

    let transferred = false;
    if (winnerId && winnerId === contest.challengerId) {
      transferred = await this.transferCell(
        contest.cellId,
        contest.defenderId,
        contest.challengerId,
      );
    }

    this.contestGateway.broadcastToContest(contestId, 'contest:ended', {
      contestId,
      winnerId,
      reason,
      transferred,
    });
  }

  /**
   * Moves the contested cell to its new owner, but only if the defender
   * still actually holds it — solo play could in principle have captured it
   * out from under them while the contest was running. Returns whether a
   * transfer actually happened.
   */
  private async transferCell(
    cellId: string,
    expectedCurrentOwnerId: string,
    newOwnerId: string,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.territoryCellOwnership.findFirst({
        where: { cellId, closedAt: null },
      });
      if (!current || current.userId !== expectedCurrentOwnerId) {
        return false;
      }

      await tx.territoryCellOwnership.update({
        where: { id: current.id },
        data: { closedAt: new Date() },
      });
      const ownership = await tx.territoryCellOwnership.create({
        data: { cellId, userId: newOwnerId, sourceType: 'contest' },
        include: { cell: true },
      });

      this.territoryGateway.broadcastCellUpdate({
        territoryId: ownership.cell.territoryId,
        cellId,
        row: ownership.cell.row,
        col: ownership.cell.col,
        ownerId: newOwnerId,
        ownerColor: getColorForUser(newOwnerId),
      });

      return true;
    });
  }

  private displayUser(u: DisplayUser) {
    return { id: u.id, name: u.name?.trim() || u.email.split('@')[0] };
  }

  private summaryInclude() {
    return {
      cell: { include: { territory: true } },
      problem: { select: { id: true, title: true, difficultyLevel: true } },
      challenger: { select: { id: true, name: true, email: true } },
      defender: { select: { id: true, name: true, email: true } },
    } as const;
  }

  private toSummaryDto(c: {
    id: string;
    status: string;
    durationSeconds: number;
    winnerId: string | null;
    endReason: string | null;
    createdAt: Date;
    startedAt: Date | null;
    endedAt: Date | null;
    cell: {
      id: string;
      row: number;
      col: number;
      territoryId: string;
      territory: { name: string; tier: string };
    };
    problem: { id: number; title: string; difficultyLevel: string };
    challenger: DisplayUser;
    defender: DisplayUser;
  }) {
    return {
      id: c.id,
      status: c.status,
      cell: {
        id: c.cell.id,
        row: c.cell.row,
        col: c.cell.col,
        territoryId: c.cell.territoryId,
        territoryName: c.cell.territory.name,
        tier: c.cell.territory.tier,
      },
      problem: c.problem,
      challenger: this.displayUser(c.challenger),
      defender: this.displayUser(c.defender),
      durationSeconds: c.durationSeconds,
      winnerId: c.winnerId,
      endReason: c.endReason,
      createdAt: c.createdAt,
      startedAt: c.startedAt,
      endedAt: c.endedAt,
    };
  }
}
