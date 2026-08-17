import { Module } from '@nestjs/common';
import { SubmissionsService } from './submissions.service';
import { SubmissionsController } from './submissions.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { JudgeModule } from '../judge/judge.module';

@Module({
  imports: [PrismaModule, JudgeModule],
  controllers: [SubmissionsController],
  providers: [SubmissionsService],
})
export class SubmissionsModule {}
