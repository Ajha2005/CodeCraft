import { Module } from '@nestjs/common';
import { LeaderboardController } from './leaderboard.controller';
import { LeaderboardRedisService } from '../common/redis/leaderboard-redis.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  
  controllers: [LeaderboardController],
  providers: [LeaderboardRedisService],
  exports: [LeaderboardRedisService],
})
export class LeaderboardModule {}