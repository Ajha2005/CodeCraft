import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { TerritoryModule } from './territory/territory.module';
import { ProblemsModule } from './problems/problems.module';
import { JudgeModule } from './judge/judge.module';
import { SubmissionsModule } from './submissions/submissions.module';
import { LeaderboardModule } from './leaderboard/leaderboard.module';
import { RedisModule } from './common/redis/redis.module';
import { ScoringModule } from './scoring/scoring.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRoot({
      connection: {
        host: 'localhost',
        port: 6379,
      },
    }),
    PrismaModule,
    RedisModule,
    AuthModule,
    TerritoryModule,
    ProblemsModule,
    JudgeModule,
    SubmissionsModule,
    LeaderboardModule,
    ScoringModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}