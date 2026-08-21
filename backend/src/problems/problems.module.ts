import { Module } from '@nestjs/common';
import { ProblemsService } from './problems.service';
import { ProblemsController } from './problems.controller';
import { JudgeModule } from '../judge/judge.module';

@Module({
  imports: [JudgeModule],
  providers: [ProblemsService],
  controllers: [ProblemsController]
})
export class ProblemsModule {}
