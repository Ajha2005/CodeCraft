import { Controller, Get, Param } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('scoring')
export class ScoringController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('user/:userId')
  async getUserScores(@Param('userId') userId: string) {
    const scores = await this.prisma.performanceScore.findMany({
      where: { submission: { userId } },
      orderBy: { createdAt: 'desc' },
    });
    const totalScore = scores.reduce((sum, s) => sum + s.totalScore, 0);
    return { totalScore, scores };
  }


  @Get('submission/:submissionId')
  async getSubmissionScore(@Param('submissionId') submissionId: string) {
    return this.prisma.performanceScore.findUnique({
      where: { submissionId },
    });
  }

  @Get('territories/:userId')
  async getUserTerritories(@Param('userId') userId: string) {
    return this.prisma.territoryOwnership.findMany({
      where: { userId, closedAt: null },
      include: { territory: true },
      orderBy: { assignedAt: 'desc' },
    });
  }

  @Get('daily-progress/:userId')
  async getDailyProgress(@Param('userId') userId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const progress = await this.prisma.dailyProgress.findUnique({
      where: { userId_date: { userId, date: today } },
    });
    return { qualifyingCount: progress?.qualifyingCount ?? 0, cap: 6 };
  }

  @Get('streak/:userId')
  async getStreak(@Param('userId') userId: string) {
    const days = await this.prisma.dailyProgress.findMany({
      where: { userId, qualifyingCount: { gt: 0 } },
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
    const DAY_MS = 24 * 60 * 60 * 1000;
    for (const t of sortedAsc) {
      run = prev !== null && t - prev === DAY_MS ? run + 1 : 1;
      longest = Math.max(longest, run);
      prev = t;
    }

    return { current, longest: Math.max(longest, current) };
  }

  @Get('campaign-summary/:userId')
  async getCampaignSummary(@Param('userId') userId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [heldCells, gainedToday, lostToday] = await Promise.all([
      this.prisma.territoryCellOwnership.findMany({
        where: { userId, closedAt: null },
        select: { cell: { select: { territoryId: true } } },
      }),
      this.prisma.territoryCellOwnership.count({
        where: { userId, createdAt: { gte: today } },
      }),
      this.prisma.territoryCellOwnership.count({
        where: { userId, closedAt: { gte: today } },
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
