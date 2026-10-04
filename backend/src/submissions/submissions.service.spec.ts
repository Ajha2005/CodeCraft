import { HttpException, NotFoundException } from '@nestjs/common';
import {
  MAX_PENDING_SUBMISSIONS,
  SubmissionsService,
} from './submissions.service';

const created = {
  id: 's1',
  problemId: 7,
  language: 'python',
  verdict: 'PENDING',
  totalPassed: 0,
  totalTests: 0,
  pointsAwarded: false,
  noPointsReason: null,
  createdAt: new Date('2026-10-05T10:00:00Z'),
};

function setup(over: { problem?: unknown; waiting?: number } = {}) {
  const prisma = {
    problem: {
      findUnique: jest
        .fn()
        .mockResolvedValue('problem' in over ? over.problem : { id: 7 }),
    },
    submission: {
      count: jest.fn().mockResolvedValue(over.waiting ?? 0),
      create: jest.fn().mockResolvedValue(created),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
  };
  const queue = { add: jest.fn().mockResolvedValue(undefined) };
  return {
    prisma,
    queue,
    service: new SubmissionsService(prisma as never, queue as never),
  };
}

const dto = { problemId: 7, language: 'python' as const, code: 'print(1)' };

describe('SubmissionsService.createSubmission', () => {
  it('stores the submission for the user in the token and queues only its id', async () => {
    const { prisma, queue, service } = setup();
    await service.createSubmission('u1', dto);

    expect(prisma.submission.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          userId: 'u1',
          problemId: 7,
          code: 'print(1)',
          language: 'python',
          verdict: 'PENDING',
        },
      }),
    );
    expect(queue.add).toHaveBeenCalledWith('judge', { submissionId: 's1' }); // no code, no hidden tests in Redis
  });

  it('returns a safe summary: no code, no user id', async () => {
    const { service } = setup();
    const result = await service.createSubmission('u1', dto);
    expect(Object.keys(result).sort()).toEqual(
      [
        'createdAt',
        'id',
        'language',
        'noPointsReason',
        'pointsAwarded',
        'problemId',
        'totalPassed',
        'totalTests',
        'verdict',
      ].sort(),
    );
  });

  it('is a 404, not a 500, for a problem that does not exist', async () => {
    const { queue, service } = setup({ problem: null });
    await expect(service.createSubmission('u1', dto)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('refuses a fourth waiting submission with a 429, so one account cannot flood the judge queue', async () => {
    const { prisma, queue, service } = setup({
      waiting: MAX_PENDING_SUBMISSIONS,
    });
    await expect(service.createSubmission('u1', dto)).rejects.toMatchObject({
      status: 429,
    });
    await expect(service.createSubmission('u1', dto)).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(prisma.submission.create).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('counts only recent waiting submissions, so a lost one cannot lock a player out for good', async () => {
    const { prisma, service } = setup();
    await service.createSubmission('u1', dto);
    const where = prisma.submission.count.mock.calls[0][0].where;
    expect(where).toMatchObject({ userId: 'u1', verdict: 'PENDING' });
    expect(where.createdAt.gte).toBeInstanceOf(Date);
  });
});

describe('SubmissionsService.getSubmission', () => {
  it('only finds the submission for its owner', async () => {
    const { prisma, service } = setup();
    prisma.submission.findFirst.mockResolvedValue(created);
    await service.getSubmission('u1', 's1');
    expect(prisma.submission.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 's1', userId: 'u1' } }),
    );
  });

  it("answers someone else's submission exactly like a missing one", async () => {
    const { prisma, service } = setup();
    prisma.submission.findFirst.mockResolvedValue(null);
    await expect(service.getSubmission('intruder', 's1')).rejects.toThrow(
      new NotFoundException('Submission not found'),
    );
  });
});

describe('SubmissionsService.getStatusByProblem', () => {
  it('lets an accepted attempt beat any other verdict', async () => {
    const { prisma, service } = setup();
    prisma.submission.findMany.mockResolvedValue([
      { problemId: 1, verdict: 'WA' },
      { problemId: 1, verdict: 'AC' },
      { problemId: 1, verdict: 'WA' },
      { problemId: 2, verdict: 'TLE' },
    ]);
    await expect(service.getStatusByProblem('u1')).resolves.toEqual({
      1: 'AC',
      2: 'ATTEMPTED',
    });
  });
});
