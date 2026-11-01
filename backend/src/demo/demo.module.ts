import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ScoringModule } from '../scoring/scoring.module';
import { DemoController } from './demo.controller';
import { DemoRateLimitGuard } from './demo-rate-limit.guard';

@Module({
  imports: [ScoringModule, BullModule.registerQueue({ name: 'submissions' })],
  controllers: [DemoController],
  providers: [DemoRateLimitGuard],
})
export class DemoModule {}
