import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, HttpException, HttpStatus, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { ScoringService } from '../scoring/scoring.service';
import { DemoSubmissionDto } from './dto/demo-submission.dto';
import { DemoRateLimitGuard } from './demo-rate-limit.guard';

/** Past this many waiting jobs, demo visitors are turned away so signed-in players never queue behind them. */
const MAX_BACKLOG = 40;
const KEEP_RESULT_SECONDS = 15 * 60;

/**
 * "Try it without an account". A demo submission is judged by the same judge and
 * scored by the same formula, but nothing about it is saved: no user, no
 * submission row, no leaderboard entry and - by design - no territory cell. The
 * browser keeps the demo player's score for them.
 */
@UseGuards(DemoRateLimitGuard)
@Controller('demo')
export class DemoController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scoringService: ScoringService,
    @InjectQueue('submissions') private readonly queue: Queue,
  ) {}

  @Post('submissions')
  async create(@Body() dto: DemoSubmissionDto) {
    const problem = await this.prisma.problem.findUnique({
      where: { id: dto.problemId },
      select: { testCases: true, difficultyLevel: true },
    });
    if (!problem) throw new NotFoundException('Problem not found');

    if ((await this.queue.getWaitingCount()) >= MAX_BACKLOG) {
      throw new HttpException('The judge is busy right now - try again in a moment.', HttpStatus.SERVICE_UNAVAILABLE);
    }

    const job = await this.queue.add(
      'judge',
      {
        demo: true,
        code: dto.code,
        language: dto.language,
        testCases: problem.testCases,
        difficultyLevel: problem.difficultyLevel,
        attempts: dto.attempts ?? 1,
      },
      // an unguessable id, so one visitor cannot read another's result
      { jobId: `demo-${randomUUID()}`, removeOnComplete: { age: KEEP_RESULT_SECONDS }, removeOnFail: { age: KEEP_RESULT_SECONDS } },
    );
    return { id: String(job.id), verdict: 'PENDING', totalPassed: 0, totalTests: 0 };
  }

  @Get('submissions/:id')
  async getOne(@Param('id') id: string) {
    const job = await this.queue.getJob(id);
    // Only demo jobs are readable here; a real submission's job id is not a way in.
    if (!job || !job.data?.demo) throw new NotFoundException('Submission not found');

    const state = await job.getState();
    if (state === 'failed') return { id, verdict: 'ERROR', totalPassed: 0, totalTests: 0, score: null };
    if (state !== 'completed') return { id, verdict: 'PENDING', totalPassed: 0, totalTests: 0, score: null };

    const result = job.returnvalue as { verdict: string; totalPassed: number; totalTests: number };
    const score =
      result.verdict === 'AC'
        ? this.scoringService.computeScore({ difficultyLevel: job.data.difficultyLevel, attempts: job.data.attempts })
        : null;
    return { id, verdict: result.verdict, totalPassed: result.totalPassed, totalTests: result.totalTests, score };
  }
}
