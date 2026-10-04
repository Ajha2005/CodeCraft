import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuthModule } from '../auth/auth.module';
import { ContestService } from './contest.service';
import { ContestController } from './contest.controller';
import { ContestGateway } from './contest.gateway';
import { ContestTimeoutProcessor } from './contest-timeout.processor';
import { ProblemsModule } from '../problems/problems.module';
import { TerritoryModule } from '../territory/territory.module';

@Module({
  imports: [
    ProblemsModule,
    TerritoryModule,
    AuthModule, // the duel gateway verifies access tokens with the same JwtService as the REST guard
    BullModule.registerQueue(
      { name: 'submissions' },
      { name: 'contest-timeout' },
    ),
  ],
  controllers: [ContestController],
  providers: [ContestService, ContestGateway, ContestTimeoutProcessor],
  exports: [ContestService],
})
export class ContestModule {}
