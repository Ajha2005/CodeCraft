import { Controller, Get, Param, Query } from '@nestjs/common';
import { LeaderboardRedisService } from '../common/redis/leaderboard-redis.service';
import { PrismaService } from '../prisma/prisma.service';
import { colorFromIndex, UNCLAIMED_COLOR } from '../common/color/color.util';

export interface LeaderboardEntryDto {
  userId: string;
  name: string;
  score: number;
  /** The player's own map colour, unique to them. */
  color: string;
}

/** A positive whole number from a query string, capped; anything else gets the default. */
function parseLimit(raw: string | undefined, fallback: number, max = 100): number {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
}

@Controller('leaderboard')
export class LeaderboardController {
  constructor(
    private readonly leaderboardRedis: LeaderboardRedisService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('college')
  async getCollegeLeaderboard(@Query('limit') limit?: string): Promise<LeaderboardEntryDto[]> {
    const raw = await this.leaderboardRedis.getCollegeTop(parseLimit(limit, 50));
    return this.attachNames(raw);
  }

  @Get('territory/:id')
  async getTerritoryLeaderboard(
    @Param('id') territoryId: string,
    @Query('limit') limit?: string,
  ): Promise<LeaderboardEntryDto[]> {
    const raw = await this.leaderboardRedis.getTerritoryTop(territoryId, parseLimit(limit, 20));
    return this.attachNames(raw);
  }

  @Get('rank/:userId')
  async getUserRank(@Param('userId') userId: string) {
    const rank = await this.leaderboardRedis.getCollegeRank(userId);
    return { userId, rank };
  }

  @Get('near-miss/:userId')
  async getNearMiss(@Param('userId') userId: string) {
    const rank = await this.leaderboardRedis.getCollegeRank(userId);
    if (!rank || rank <= 1) {
      return { rank, pointsToNext: 0, nextRankName: null };
    }

    const [myScore, above] = await Promise.all([
      this.leaderboardRedis.getCollegeScore(userId),
      this.leaderboardRedis.getCollegeEntryAtRank(rank - 2),
    ]);

    if (myScore === null || !above) {
      return { rank, pointsToNext: 0, nextRankName: null };
    }

    const [named] = await this.attachNames([above]);
    return {
      rank,
      pointsToNext: Math.max(0, above.score - myScore),
      nextRankName: named?.name ?? null,
    };
  }

  private async attachNames(
    raw: { userId: string; score: number }[],
  ): Promise<LeaderboardEntryDto[]> {
    if (raw.length === 0) return [];

    const userIds = raw.map((r) => r.userId);
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true, colorIndex: true },
    });

    const userMap = new Map(users.map((u) => [u.id, u]));

    return raw.map((entry) => {
      const user = userMap.get(entry.userId);
      const displayName = user?.name?.trim() || user?.email?.split('@')[0] || entry.userId.slice(0, 8);
      return {
        userId: entry.userId,
        name: displayName,
        score: entry.score,
        color: user ? colorFromIndex(user.colorIndex) : UNCLAIMED_COLOR,
      };
    });
  }
}