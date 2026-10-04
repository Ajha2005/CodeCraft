import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ExecutionLimiter } from './execution-limiter';
import { JudgeService } from './judge.service';

// No controller on purpose: code only ever runs through the graded pipeline
// (SubmissionsProcessor) or POST /run (RunModule), both of which check who is
// asking. The old open /judge/* routes were removed.
@Module({
  imports: [HttpModule.register({ maxRedirects: 0 })],
  providers: [JudgeService, ExecutionLimiter],
  exports: [JudgeService, ExecutionLimiter],
})
export class JudgeModule {}
