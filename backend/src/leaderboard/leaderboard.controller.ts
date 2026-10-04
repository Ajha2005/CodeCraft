import { Controller, Get, Param, Query } from '@nestjs/common';
import { LeaderboardRedisService } from '../common/redis/leaderboard-redis.service';
import { PrismaService } from '../prisma/prisma.service';

export interface LeaderboardEntryDto {
  userId: string;
  /** What profile links point at; null when the player no longer exists. */
  username: string | null;
  /** The name to show: the username (kept for the login page), or a short id as a last resort. */
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
      select: { id: true, username: true },
    });

    const userMap = new Map(users.map((u) => [u.id, u]));

    return raw.map((entry) => {
      const user = userMap.get(entry.userId);
      // The public name of a player is their username, never their real name or email.
      const displayName = user?.username ?? entry.userId.slice(0, 8);
      return {
        userId: entry.userId,
        username: user?.username ?? null,
        name: displayName,
        score: entry.score,
      };
    });
  }
}