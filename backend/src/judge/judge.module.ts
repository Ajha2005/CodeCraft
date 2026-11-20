import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { JudgeService } from './judge.service';

@Module({
  imports: [HttpModule],
  providers: [JudgeService],
  exports: [JudgeService],
})
export class JudgeModule {}
