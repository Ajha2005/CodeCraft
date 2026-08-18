import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { JudgeService } from '../judge/judge.service';

@Processor('submissions')
export class SubmissionsProcessor extends WorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly judgeService: JudgeService,
  ) {
    super();
  }

  async process(job: Job): Promise<any> {
    const { submissionId, code, testCases } = job.data;

    const judgeResult = await this.judgeService.runAllTestCases(code, testCases);

    await this.prisma.submission.update({
      where: { id: submissionId },
      data: {
        verdict: judgeResult.verdict,
        totalPassed: judgeResult.totalPassed,
        totalTests: judgeResult.totalTests,
      },
    });

    return judgeResult;
  }
}
