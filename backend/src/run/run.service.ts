import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AuthUser } from '../auth/auth-user';
import { JudgeService } from '../judge/judge.service';
import { PrismaService } from '../prisma/prisma.service';
import { RunCaseResult, RunDto, RunResult } from './run.dto';

const MAX_TEXT = 4000;

interface Sample {
  input: Record<string, unknown>;
  output: unknown;
}

const clip = (text: unknown) => {
  const asText =
    typeof text === 'string' ? text : text == null ? '' : JSON.stringify(text);
  return asText.slice(0, MAX_TEXT);
};

/** Reads the problem's published `examples` into a usable list, ignoring anything malformed. */
function readSamples(examples: unknown): Sample[] {
  if (!Array.isArray(examples)) return [];
  const samples: Sample[] = [];
  for (const item of examples as { input?: unknown; output?: unknown }[]) {
    if (
      item &&
      typeof item === 'object' &&
      item.input &&
      typeof item.input === 'object' &&
      !Array.isArray(item.input) &&
      'output' in item
    ) {
      samples.push({
        input: item.input as Record<string, unknown>,
        output: item.output,
      });
    }
  }
  return samples;
}

/**
 * "Run" on the problem page: execute the caller's code against the problem's
 * SAMPLE cases (the `examples` shown to everyone) and show what happened.
 *
 * What this deliberately does not do: it never touches the hidden test cases
 * except to learn the parameter types for the wrapper (shapes, not values); it
 * writes nothing, so no Submission, PerformanceScore, DailyProgress or
 * territory row can come out of it; and it queues behind graded submissions
 * (priority), with demo sessions last and limited to one slot at a time.
 */
@Injectable()
export class RunService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly judge: JudgeService,
  ) {}

  async runSamples(dto: RunDto, user: AuthUser): Promise<RunResult> {
    const problem = await this.prisma.problem.findUnique({
      where: { id: dto.problemId },
      select: { examples: true, testCases: true },
    });
    if (!problem) throw new NotFoundException('Problem not found');

    const samples = readSamples(problem.examples);
    if (samples.length === 0)
      throw new UnprocessableEntityException(
        'This problem has no sample cases to run yet.',
      );

    // Types are inferred from the hidden cases so a sample runs through the very same wrapper a graded run would use.
    const hidden = Array.isArray(problem.testCases)
      ? (problem.testCases as { input: Record<string, unknown> }[])
      : [];
    const paramTypes = this.judge.inferParamTypes(
      hidden.length > 0 ? hidden : samples,
    );
    const priority = user.isGuest ? 'guest' : 'user';

    const results: RunCaseResult[] = [];
    for (const [index, sample] of samples.entries()) {
      const started = performance.now();
      const outcome = await this.judge.runSingleTestCase(
        dto.code,
        sample.input as Record<string, any>,
        sample.output,
        dto.language,
        paramTypes,
        priority,
      );
      const failed =
        outcome.status === 'CE' ||
        outcome.status === 'RE' ||
        outcome.status === 'TLE';
      results.push({
        index,
        input: sample.input,
        expectedOutput: clip(outcome.expectedOutput),
        actualOutput: clip(outcome.actualOutput),
        status: outcome.status,
        passed: outcome.passed,
        runtimeMs: Math.round(performance.now() - started),
        ...(failed && outcome.stderr ? { error: clip(outcome.stderr) } : {}),
      });
      if (outcome.status === 'CE') break; // it will not compile for the other samples either
    }

    const passed = results.filter((r) => r.passed).length;
    const firstFailure = results.find((r) => !r.passed);
    return {
      problemId: dto.problemId,
      language: dto.language,
      passed,
      total: samples.length,
      verdict: firstFailure ? firstFailure.status : 'AC',
      results,
    };
  }
}
