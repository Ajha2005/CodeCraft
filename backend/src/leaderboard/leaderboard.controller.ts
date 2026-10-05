import { Controller, Get, Param, Query, UnauthorizedException } from '@nestjs/common';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';
import { getColorForUser } from '../common/color/color.util';
import { LeaderboardRedisService } from '../common/redis/leaderboard-redis.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * One row of a public board: a handle and a score. `isMe` is computed on the
 * server for the caller, and `color` is the player's map color (derived from
 * their id on the server, so the client never needs the id to draw them).
 */
export interface LeaderboardEntryDto {
  username: string;
  score: number;
  isMe: boolean;
  color: string;
}

class LimitQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

@Controller('leaderboard')
export class LeaderboardController {
  constructor(
    private readonly leaderboardRedis: LeaderboardRedisService,
    private readonly prisma: PrismaService,
  ) {}

  // Public only for the login page's "top score" teaser: without a token the
  // board can be read one row deep, with any valid token (guests included) in full.
  @Public()
  @Get('college')
  async getCollegeLeaderboard(@Query() query: LimitQuery, @CurrentUser() user?: AuthUser): Promise<LeaderboardEntryDto[]> {
    const limit = query.limit ?? 50;
    if (!user && limit > 1) throw new UnauthorizedException();
    const raw = await this.leaderboardRedis.getCollegeTop(limit);
    return this.attachNames(raw, user);
  }

  @Get('territory/:id')
  async getTerritoryLeaderboard(
    @Param('id') territoryId: string,
    @Query() query: LimitQuery,
    @CurrentUser() user: AuthUser,
  ): Promise<LeaderboardEntryDto[]> {
    const raw = await this.leaderboardRedis.getTerritoryTop(territoryId, query.limit ?? 20);
    return this.attachNames(raw, user);
  }

  @Get('me/rank')
  async getMyRank(@CurrentUser() user: AuthUser) {
    if (user.isGuest) return { rank: null };
    return { rank: await this.leaderboardRedis.getCollegeRank(user.userId) };
  }

  @Get('me/near-miss')
  async getMyNearMiss(@CurrentUser() user: AuthUser) {
    if (user.isGuest) return { rank: null, pointsToNext: 0, nextRankName: null };
    const rank = await this.leaderboardRedis.getCollegeRank(user.userId);
    if (!rank || rank <= 1) {
      return { rank, pointsToNext: 0, nextRankName: null };
    }

    const [myScore, above] = await Promise.all([
      this.leaderboardRedis.getCollegeScore(user.userId),
      this.leaderboardRedis.getCollegeEntryAtRank(rank - 2),
    ]);

    if (myScore === null || !above) {
      return { rank, pointsToNext: 0, nextRankName: null };
    }

    const [named] = await this.attachNames([above], user);
    return {
      rank,
      pointsToNext: Math.max(0, above.score - myScore),
      nextRankName: named?.username ?? null,
    };
  }

  /** Turns Redis rows (user id + score) into public rows. Ids never leave this method; players who no longer exist are dropped. */
  private async attachNames(raw: { userId: string; score: number }[], viewer?: AuthUser): Promise<LeaderboardEntryDto[]> {
    if (raw.length === 0) return [];

    const users = await this.prisma.user.findMany({
      where: { id: { in: raw.map((r) => r.userId) } },
      select: { id: true, username: true },
    });
    const usernameById = new Map(users.map((u) => [u.id, u.username]));

    const entries: LeaderboardEntryDto[] = [];
    for (const entry of raw) {
      const username = usernameById.get(entry.userId);
      if (!username) continue;
      entries.push({
        username,
        score: entry.score,
        isMe: !!viewer && !viewer.isGuest && viewer.userId === entry.userId,
        color: getColorForUser(entry.userId),
      });
    }
    return entries;
  }
}
