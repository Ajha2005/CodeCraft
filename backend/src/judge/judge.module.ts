import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ExecutionLimiter } from './execution-limiter';
import { JudgeService } from './judge.service';

// No controller on purpose: code only ever runs through the graded pipeline
// (SubmissionsProcessor) or POST /run (RunModule), and both know who is asking.
// The old open /judge/* routes ran anyone's code with no login and no limit,
// and the app never called them.
@Module({
  imports: [HttpModule],
  providers: [JudgeService, ExecutionLimiter],
  exports: [JudgeService, ExecutionLimiter],
})
export class JudgeModule {}
