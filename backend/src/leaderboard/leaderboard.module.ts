import { Module } from '@nestjs/common';
import { LeaderboardController } from './leaderboard.controller';
import { LeaderboardRedisService } from '../common/redis/leaderboard-redis.service';

@Module({
  controllers: [LeaderboardController],
  providers: [LeaderboardRedisService],
  exports: [LeaderboardRedisService],
})
export class LeaderboardModule {}