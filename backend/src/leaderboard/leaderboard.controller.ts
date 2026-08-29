import { Controller, Get, Param, Query } from '@nestjs/common';
import { LeaderboardRedisService } from '../common/redis/leaderboard-redis.service';

@Controller('leaderboard')
export class LeaderboardController {
  constructor(private readonly leaderboardRedis: LeaderboardRedisService) {}

  @Get('college')
  async getCollegeLeaderboard(@Query('limit') limit?: string) {
    const parsedLimit = limit ? parseInt(limit, 10) : 50;
    return this.leaderboardRedis.getCollegeTop(parsedLimit);
  }

  @Get('territory/:id')
  async getTerritoryLeaderboard(
    @Param('id') territoryId: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : 20;
    return this.leaderboardRedis.getTerritoryTop(territoryId, parsedLimit);
  }

  @Get('rank/:userId')
  async getUserRank(@Param('userId') userId: string) {
    const rank = await this.leaderboardRedis.getCollegeRank(userId);
    return { userId, rank };
  }
}