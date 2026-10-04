import { Module } from '@nestjs/common';
import { LeaderboardController } from './leaderboard.controller';
import { LeaderboardBootstrap } from './leaderboard-bootstrap.service';
import { LeaderboardRedisService } from '../common/redis/leaderboard-redis.service';

@Module({
  controllers: [LeaderboardController],
  providers: [LeaderboardRedisService, LeaderboardBootstrap],
  exports: [LeaderboardRedisService],
})
export class LeaderboardModule {}
