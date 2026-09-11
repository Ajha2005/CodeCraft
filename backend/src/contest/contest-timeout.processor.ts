import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ContestService } from './contest.service';

/**
 * Handles the two delayed, time-based contest transitions that nothing else
 * triggers on their own:
 *  - 'resolve-timeout': the match clock ran out with no AC from either side
 *    (scheduled in ContestService.accept, delay = durationSeconds).
 *  - 'expire-pending': a challenge the defender never responded to
 *    (scheduled in ContestService.createChallenge, delay = 5 minutes).
 * Both handlers are no-ops if the contest already resolved some other way
 * (AC / forfeit / accept-or-decline) by the time the job fires.
 */
@Processor('contest-timeout', { stalledInterval: 300000 })
export class ContestTimeoutProcessor extends WorkerHost {
  private readonly logger = new Logger(ContestTimeoutProcessor.name);

  constructor(private readonly contestService: ContestService) {
    super();
  }

  async process(job: Job): Promise<void> {
    const { contestId } = job.data;

    if (job.name === 'resolve-timeout') {
      await this.contestService.resolveOnTimeout(contestId);
    } else if (job.name === 'expire-pending') {
      await this.contestService.expirePendingChallenge(contestId);
    } else {
      this.logger.warn(`Unknown contest-timeout job: ${job.name}`);
    }
  }
}
