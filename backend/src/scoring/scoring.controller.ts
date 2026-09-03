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
}
