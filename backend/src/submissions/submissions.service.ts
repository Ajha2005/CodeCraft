import { HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSubmissionDto } from './dto/create-submission.dto';
import { SubmissionDto, submissionSelect } from './submission.dto';

/** How many of one user's submissions may be waiting to be judged at once. */
export const MAX_PENDING_SUBMISSIONS = 3;
// A submission that has been PENDING this long was lost (worker crash, runner down); it no longer counts against the limit.
const PENDING_WINDOW_MS = 5 * 60 * 1000;

@Injectable()
export class SubmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('submissions') private readonly submissionsQueue: Queue,
  ) {}

  /** `userId` comes from the verified token, never from the request body. */
  async createSubmission(userId: string, dto: CreateSubmissionDto): Promise<SubmissionDto> {
    const problem = await this.prisma.problem.findUnique({ where: { id: dto.problemId }, select: { id: true } });
    if (!problem) throw new NotFoundException('Problem not found');

    const waiting = await this.prisma.submission.count({
      where: { userId, verdict: 'PENDING', createdAt: { gte: new Date(Date.now() - PENDING_WINDOW_MS) } },
    });
    if (waiting >= MAX_PENDING_SUBMISSIONS) {
      throw new HttpException('You already have submissions waiting to be judged. Wait for them to finish first.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const submission = await this.prisma.submission.create({
      data: { userId, problemId: dto.problemId, code: dto.code, language: dto.language, verdict: 'PENDING' },
      select: submissionSelect,
    });
    // The queue only carries the id. The worker reads the code and the hidden
    // test cases from Postgres, so neither ever sits in Redis.
    await this.submissionsQueue.add('judge', { submissionId: submission.id });
    return submission;
  }

  /** Only the owner can read a submission; anyone else gets the same 404 as for a missing id. */
  async getSubmission(userId: string, id: string): Promise<SubmissionDto> {
    const submission = await this.prisma.submission.findFirst({ where: { id, userId }, select: submissionSelect });
    if (!submission) throw new NotFoundException('Submission not found');
    return submission;
  }

  /**
   * Best verdict per problem for a user — 'AC' beats any non-AC verdict,
   * which beats never having submitted at all. Powers the "uncharted
   * territory" vs "you've been here before" hover copy on the problem list.
   */
  async getStatusByProblem(userId: string): Promise<Record<number, 'AC' | 'ATTEMPTED'>> {
    const submissions = await this.prisma.submission.findMany({
      where: { userId, verdict: { not: 'PENDING' } },
      select: { problemId: true, verdict: true },
    });

    const status: Record<number, 'AC' | 'ATTEMPTED'> = {};
    for (const s of submissions) {
      if (s.verdict === 'AC') {
        status[s.problemId] = 'AC';
      } else if (status[s.problemId] !== 'AC') {
        status[s.problemId] = 'ATTEMPTED';
      }
    }
    return status;
  }
}
