import { Controller, Get, NotFoundException, Param, ParseUUIDPipe } from '@nestjs/common';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

const DAILY_CAP = 6;
const DAY_MS = 24 * 60 * 60 * 1000;

// Everything here is about the caller's own account, so every route is "/me":
// there is no user id in any path, and nobody can ask about someone else.
// A demo (guest) session has no account, so it gets the same empty/zero
// answers a brand-new player would.
@Controller('scoring')
export class ScoringController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('me')
  async getMyScores(@CurrentUser() user: AuthUser) {
    if (user.isGuest) return { totalScore: 0, scores: [] };
    const scores = await this.prisma.performanceScore.findMany({
      where: { submission: { userId: user.userId } },
      orderBy: { createdAt: 'desc' },
    });
    const totalScore = scores.reduce((sum, s) => sum + s.totalScore, 0);
    return { totalScore, scores };
  }

  /** The score of one of the caller's own submissions. A submission that is not theirs is simply "not found". */
  @Get('submission/:submissionId')
  async getSubmissionScore(@CurrentUser() user: AuthUser, @Param('submissionId', ParseUUIDPipe) submissionId: string) {
    const score = user.isGuest
      ? null
      : await this.prisma.performanceScore.findFirst({ where: { submissionId, submission: { userId: user.userId } } });
    if (!score) throw new NotFoundException('Score not found');
    return score;
  }

  @Get('me/territories')
  async getMyTerritories(@CurrentUser() user: AuthUser) {
    if (user.isGuest) return [];
    // Territory-level ownership is derived from cell ownership rather than
    // tracked separately: capturing a solve only ever creates/moves a
    // TerritoryCellOwnership row (see SubmissionsProcessor.assignTerritory),
    // so a query against TerritoryOwnership here would always come back
    // empty even for a user holding plenty of cells.
    const ownerships = await this.prisma.territoryCellOwnership.findMany({
      where: { userId: user.userId, closedAt: null, cell: { retiredAt: null } },
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

  @Get('me/daily-progress')
  async getMyDailyProgress(@CurrentUser() user: AuthUser) {
    if (user.isGuest) return { qualifyingCount: 0, cap: DAILY_CAP };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const progress = await this.prisma.dailyProgress.findUnique({
      where: { userId_date: { userId: user.userId, date: today } },
    });
    return { qualifyingCount: progress?.qualifyingCount ?? 0, cap: DAILY_CAP };
  }

  @Get('me/streak')
  async getMyStreak(@CurrentUser() user: AuthUser) {
    if (user.isGuest) return { current: 0, longest: 0 };
    const days = await this.prisma.dailyProgress.findMany({
      where: { userId: user.userId, qualifyingCount: { gt: 0 } },
      select: { date: true },
      orderBy: { date: 'desc' },
    });

    const activeDates = new Set(days.map((d) => d.date.getTime()));

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

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
      cursor = new Date(cursor);
      cursor.setDate(cursor.getDate() - 1);
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

  @Get('me/campaign-summary')
  async getMyCampaignSummary(@CurrentUser() user: AuthUser) {
    if (user.isGuest) return { territoriesHeld: 0, cellsGainedToday: 0, cellsLostToday: 0 };
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [heldCells, gainedToday, lostToday] = await Promise.all([
      this.prisma.territoryCellOwnership.findMany({
        where: { userId: user.userId, closedAt: null, cell: { retiredAt: null } },
        select: { cell: { select: { territoryId: true } } },
      }),
      this.prisma.territoryCellOwnership.count({
        where: { userId: user.userId, createdAt: { gte: today }, cell: { retiredAt: null } },
      }),
      // Cells closed because the map was redrawn (their cell is retired) are not "lost".
      this.prisma.territoryCellOwnership.count({
        where: { userId: user.userId, closedAt: { gte: today }, cell: { retiredAt: null } },
      }),
    ]);

    const territoriesHeld = new Set(heldCells.map((c) => c.cell.territoryId)).size;

    return {
      territoriesHeld,
      cellsGainedToday: gainedToday,
      cellsLostToday: lostToday,
    };
  }
}
