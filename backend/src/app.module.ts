import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ThrottlerModule } from '@nestjs/throttler';
import Redis from 'ioredis';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { AccessGuard } from './auth/access.guard';
import { TerritoryModule } from './territory/territory.module';
import { ProblemsModule } from './problems/problems.module';
import { JudgeModule } from './judge/judge.module';
import { SubmissionsModule } from './submissions/submissions.module';
import { LeaderboardModule } from './leaderboard/leaderboard.module';
import { RedisModule } from './common/redis/redis.module';
import { ScoringModule } from './scoring/scoring.module';
import { ContestModule } from './contest/contest.module';
import { UsersModule } from './users/users.module';
import { HealthModule } from './health/health.module';
import { AuditModule } from './audit/audit.module';
import { RunModule } from './run/run.module';
import { AppThrottlerGuard } from './common/guards/app-throttler.guard';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRootAsync({
      useFactory: () => ({
        connection: process.env.REDIS_URL
          ? new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null })
          : { host: 'localhost', port: 6379 },
        // Finished jobs are not kept: Redis Cloud's free plan has 30 MB and no
        // persistence, and a job record should not outlive its usefulness.
        defaultJobOptions: { removeOnComplete: true, removeOnFail: { age: 3600, count: 100 }, attempts: 1 },
      }),
    }),
    // Per-account (or per-IP for anonymous and demo callers) budget; routes that
    // need less say so with @Throttle(). See AppThrottlerGuard for how callers are counted.
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 240 }],
      errorMessage: 'Too many requests. Please slow down.',
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
    ContestModule,
    UsersModule,
    HealthModule,
    AuditModule,
    RunModule,
  ],
  providers: [
    // Order matters: the access guard identifies the caller first, then the throttler counts them.
    { provide: APP_GUARD, useClass: AccessGuard },
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
