import { Module } from '@nestjs/common';
import { JudgeModule } from '../judge/judge.module';
import { RunController } from './run.controller';
import { RunService } from './run.service';

@Module({
  imports: [JudgeModule],
  controllers: [RunController],
  providers: [RunService],
})
export class RunModule {}
