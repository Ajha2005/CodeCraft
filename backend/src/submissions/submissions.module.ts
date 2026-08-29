import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SubmissionsService } from './submissions.service';
import { SubmissionsController } from './submissions.controller';
import { SubmissionsProcessor } from './submissions.processor';
import { PrismaModule } from '../prisma/prisma.module';
import { JudgeModule } from '../judge/judge.module';
import { ScoringModule } from '../scoring/scoring.module';
import { LeaderboardModule } from '../leaderboard/leaderboard.module';
import { TerritoryModule } from '../territory/territory.module';

@Module({
  imports: [
    PrismaModule,
    JudgeModule,
    ScoringModule,
    LeaderboardModule,
    TerritoryModule,
    BullModule.registerQueue({
      name: 'submissions',
    }),
  ],
  controllers: [SubmissionsController],
  providers: [SubmissionsService, SubmissionsProcessor],
})
export class SubmissionsModule {}
