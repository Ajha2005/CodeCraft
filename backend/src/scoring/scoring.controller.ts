import { Controller, Get, Param } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { campusDay, campusDayStart, DAY_MS } from '../common/date/day.util';
import { DAILY_LIMIT } from './scoring.constants';

/** The cell a correct solve won, as the scoring tab and the result panel show it. */
export interface AwardedCellDto {
  id: string;
  territoryId: string;
  territoryName: string;
  tier: string;
  row: number;
  col: number;
  /** Taken from a rival rather than claimed free. */
  captured: boolean;
  /** Still the player's; false once a rival or a duel has taken it since. */
  held: boolean;
}

// What a score needs to know about the solve behind it: the problem, and the
// cell that solve earned (the ownership row written together with the score).
const SOLVE_INCLUDE = {
  submission: {
    select: {
      problem: { select: { id: true, title: true, difficultyLevel: true } },
      cellOwnerships: {
        where: { sourceType: 'solve' },
        orderBy: { createdAt: 'desc' as const },
        take: 1,
        include: { cell: { include: { territory: true } } },
      },
    },
  },
} as const;

type SolveRow = {
  submission: {
    problem: { id: number; title: string; difficultyLevel: string };
    cellOwnerships: {
      captured: boolean;
      closedAt: Date | null;
      cell: {
        id: string;
        row: number;
        col: number;
        territoryId: string;
        territory: { name: string; tier: string };
      };
    }[];
  };
};

function describeSolve({ submission }: SolveRow) {
  const own = submission.cellOwnerships[0];
  const cell: AwardedCellDto | null = own
    ? {
        id: own.cell.id,
        territoryId: own.cell.territoryId,
        territoryName: own.cell.territory.name,
        tier: own.cell.territory.tier,
        row: own.cell.row,
        col: own.cell.col,
        captured: own.captured,
        held: own.closedAt === null,
      }
    : null;
  return { problem: submission.problem, cell };
}

@Controller('scoring')
export class ScoringController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('user/:userId')
  async getUserScores(@Param('userId') userId: string) {
    const scores = await this.prisma.performanceScore.findMany({
      where: { submission: { userId } },
      orderBy: { createdAt: 'desc' },
      include: SOLVE_INCLUDE,
    });
    const totalScore = scores.reduce((sum, s) => sum + s.totalScore, 0);
    return {
      totalScore,
      scores: scores.map(({ submission, ...score }) => ({
        ...score,
        ...describeSolve({ submission }),
      })),
    };
  }

  @Get('submission/:submissionId')
  async getSubmissionScore(@Param('submissionId') submissionId: string) {
    const score = await this.prisma.performanceScore.findUnique({
      where: { submissionId },
      include: SOLVE_INCLUDE,
    });
    if (!score) return null;
    const { submission, ...rest } = score;
    return { ...rest, ...describeSolve({ submission }) };
  }

  @Get('territories/:userId')
  async getUserTerritories(@Param('userId') userId: string) {
    // Territory-level ownership is derived from cell ownership rather than
    // tracked separately: capturing a solve only ever creates/moves a
    // TerritoryCellOwnership row (see SubmissionsProcessor.assignTerritory),
    // so a query against TerritoryOwnership here would always come back
    // empty even for a user holding plenty of cells.
    const ownerships = await this.prisma.territoryCellOwnership.findMany({
      where: { userId, closedAt: null },
      include: { cell: { include: { territory: true } } },
      orderBy: { createdAt: 'asc' },
    });

    const firstByTerritory = new Map<string, (typeof ownerships)[number]>();
    for (const ownership of ownerships) {
      const territoryId = ownership.cell.territoryId;
      if (!firstByTerritory.has(territoryId)) {
        firstByTerritory.set(territoryId, ownership);
      }
    }

    return [...firstByTerritory.values()]
      .map((ownership) => ({
        id: ownership.id,
        territoryId: ownership.cell.territoryId,
        userId: ownership.userId,
        sourceType: ownership.sourceType,
        assignedAt: ownership.createdAt,
        closedAt: ownership.closedAt,
        territory: {
          id: ownership.cell.territory.id,
          name: ownership.cell.territory.name,
          tier: ownership.cell.territory.tier,
          baseValue: ownership.cell.territory.baseValue,
        },
      }))
      .sort((a, b) => b.assignedAt.getTime() - a.assignedAt.getTime());
  }

  @Get('daily-progress/:userId')
  async getDailyProgress(@Param('userId') userId: string) {
    const progress = await this.prisma.dailyProgress.findUnique({
      where: { userId_date: { userId, date: campusDay() } },
    });
    return { qualifyingCount: progress?.qualifyingCount ?? 0, cap: DAILY_LIMIT };
  }

  @Get('streak/:userId')
  async getStreak(@Param('userId') userId: string) {
    const days = await this.prisma.dailyProgress.findMany({
      where: { userId, qualifyingCount: { gt: 0 } },
      select: { date: true },
      orderBy: { date: 'desc' },
    });

    const activeDates = new Set(days.map((d) => d.date.getTime()));

    // Days are UTC-midnight dates of the campus calendar (see day.util), so
    // stepping back a day is plain arithmetic whatever the server's timezone.
    const today = campusDay();
    const yesterday = new Date(today.getTime() - DAY_MS);

    // A streak is still "alive" if today or yesterday was active — solving
    // nothing yet *today* shouldn't zero out a streak built over past days.
    let cursor = activeDates.has(today.getTime())
      ? today
      : activeDates.has(yesterday.getTime())
        ? yesterday
        : null;

    let current = 0;
    while (cursor && activeDates.has(cursor.getTime())) {
      current += 1;
      cursor = new Date(cursor.getTime() - DAY_MS);
    }

    // Longest streak ever, computed from the same set of active days.
    const sortedAsc = [...activeDates].sort((a, b) => a - b);
    let longest = 0;
    let run = 0;
    let prev: number | null = null;
    for (const t of sortedAsc) {
      run = prev !== null && t - prev === DAY_MS ? run + 1 : 1;
      longest = Math.max(longest, run);
      prev = t;
    }

    return { current, longest: Math.max(longest, current) };
  }

  @Get('campaign-summary/:userId')
  async getCampaignSummary(@Param('userId') userId: string) {
    const today = campusDayStart();

    const [heldCells, gainedToday, lostToday, zoneTotals] = await Promise.all([
      this.prisma.territoryCellOwnership.findMany({
        where: { userId, closedAt: null },
        select: { cell: { select: { territoryId: true, territory: { select: { name: true, tier: true } } } } },
      }),
      this.prisma.territoryCellOwnership.count({
        where: { userId, createdAt: { gte: today } },
      }),
      this.prisma.territoryCellOwnership.count({
        where: { userId, closedAt: { gte: today } },
      }),
      this.prisma.territoryCell.groupBy({ by: ['territoryId'], _count: { _all: true } }),
    ]);

    const heldByZone = new Map<string, { name: string; tier: string; held: number }>();
    const cellsByTier: Record<string, number> = { OUTPOST: 0, SETTLEMENT: 0, STRONGHOLD: 0, CITADEL: 0 };
    for (const { cell } of heldCells) {
      const zone = heldByZone.get(cell.territoryId) ?? { name: cell.territory.name, tier: cell.territory.tier, held: 0 };
      zone.held += 1;
      heldByZone.set(cell.territoryId, zone);
      cellsByTier[cell.territory.tier] = (cellsByTier[cell.territory.tier] ?? 0) + 1;
    }

    const totals = new Map(zoneTotals.map((z) => [z.territoryId, z._count._all]));
    // A zone is "won" once the player holds more than half of its cells.
    const majorityZones = [...heldByZone.entries()]
      .map(([territoryId, z]) => ({ territoryId, name: z.name, tier: z.tier, held: z.held, total: totals.get(territoryId) ?? 0 }))
      .filter((z) => z.total > 0 && z.held * 2 > z.total);

    return {
      territoriesHeld: heldByZone.size,
      cellsHeld: heldCells.length,
      cellsByTier,
      majorityZones,
      cellsGainedToday: gainedToday,
      cellsLostToday: lostToday,
    };
  }
}
