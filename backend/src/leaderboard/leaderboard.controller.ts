import { Controller, Get, Param, Query } from '@nestjs/common';
import { LeaderboardRedisService } from '../common/redis/leaderboard-redis.service';
import { PrismaService } from '../prisma/prisma.service';

export interface LeaderboardEntryDto {
  userId: string;
  name: string;
  score: number;
}

@Controller('leaderboard')
export class LeaderboardController {
  constructor(
    private readonly leaderboardRedis: LeaderboardRedisService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('college')
  async getCollegeLeaderboard(@Query('limit') limit?: string): Promise<LeaderboardEntryDto[]> {
    const parsedLimit = limit ? parseInt(limit, 10) : 50;
    const raw = await this.leaderboardRedis.getCollegeTop(parsedLimit);
    return this.attachNames(raw);
  }

  @Get('territory/:id')
  async getTerritoryLeaderboard(
    @Param('id') territoryId: string,
    @Query('limit') limit?: string,
  ): Promise<LeaderboardEntryDto[]> {
    const parsedLimit = limit ? parseInt(limit, 10) : 20;
    const raw = await this.leaderboardRedis.getTerritoryTop(territoryId, parsedLimit);
    return this.attachNames(raw);
  }

  @Get('rank/:userId')
  async getUserRank(@Param('userId') userId: string) {
    const rank = await this.leaderboardRedis.getCollegeRank(userId);
    return { userId, rank };
  }

  private async attachNames(
    raw: { userId: string; score: number }[],
  ): Promise<LeaderboardEntryDto[]> {
    if (raw.length === 0) return [];

    const userIds = raw.map((r) => r.userId);
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true },
    });

    const userMap = new Map(users.map((u) => [u.id, u]));

    return raw.map((entry) => {
      const user = userMap.get(entry.userId);
      const displayName = user?.name?.trim() || user?.email?.split('@')[0] || entry.userId.slice(0, 8);
      return {
        userId: entry.userId,
        name: displayName,
        score: entry.score,
      };
    });
  }
}