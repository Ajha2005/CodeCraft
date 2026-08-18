import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SubmissionsService } from './submissions.service';
import { SubmissionsController } from './submissions.controller';
import { SubmissionsProcessor } from './submissions.processor';
import { PrismaModule } from '../prisma/prisma.module';
import { JudgeModule } from '../judge/judge.module';

@Module({
  imports: [
    PrismaModule,
    JudgeModule,
    BullModule.registerQueue({
      name: 'submissions',
    }),
  ],
  controllers: [SubmissionsController],
  providers: [SubmissionsService, SubmissionsProcessor],
})
export class SubmissionsModule {}
