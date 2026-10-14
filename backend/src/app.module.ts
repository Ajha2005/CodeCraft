import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ThrottlerModule } from '@nestjs/throttler';
import Redis from 'ioredis';
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
import { ContestModule } from './contest/contest.module';
import { RunModule } from './run/run.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRoot({
      connection: process.env.REDIS_URL
        ? new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null })
        : { host: 'localhost', port: 6379 },
    }),
    // Used route by route (see AppThrottlerGuard), not as a blanket limit: a route says how many calls it allows.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 60 }]),
    PrismaModule,
    RedisModule,
    AuthModule,
    TerritoryModule,
    ProblemsModule,
    JudgeModule,
    SubmissionsModule,
    LeaderboardModule,
    ScoringModule,
    ContestModule,
    RunModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
