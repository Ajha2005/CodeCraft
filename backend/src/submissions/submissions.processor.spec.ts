import { getColorForUser } from '../common/color/color.util';
import { SubmissionsProcessor } from './submissions.processor';

function setup() {
  const prisma = {
    territoryCellOwnership: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ user: { username: 'arjun_m' } }),
      update: jest.fn(),
    },
    territoryCell: { findFirst: jest.fn(), findMany: jest.fn() },
  };
  const territoryGateway = { broadcastCellUpdate: jest.fn(), broadcastLeaderboardUpdate: jest.fn() };
  const contestService = { lockedCellIds: jest.fn().mockResolvedValue([] as string[]), handleSubmissionResult: jest.fn() };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const judge = { runAllTestCases: jest.fn() };
  const processor = new SubmissionsProcessor(
    prisma as never,
    judge as never,
    null as never,
    null as never,
    territoryGateway as never,
    contestService as never,
    audit as never,
  );
  const assignTerritory = (userId: string, tier: string) =>
    (processor as unknown as { assignTerritory(u: string, t: string): Promise<void> }).assignTerritory(userId, tier);
  return { prisma, territoryGateway, contestService, audit, judge, processor, assignTerritory };
}

describe('SubmissionsProcessor territory broadcasts', () => {
  it("tells the map the claimer's username when a free cell is claimed", async () => {
    const { prisma, territoryGateway, assignTerritory } = setup();
    prisma.territoryCell.findFirst.mockResolvedValue({ id: 'c1', territoryId: 't1', row: 0, col: 1 });

    await assignTerritory('u1', 'OUTPOST');

    expect(prisma.territoryCellOwnership.create).toHaveBeenCalledWith({
      data: { cellId: 'c1', userId: 'u1', sourceType: 'solve' },
      include: { user: { select: { username: true } } },
    });
    expect(territoryGateway.broadcastCellUpdate).toHaveBeenCalledWith({
      territoryId: 't1',
      cellId: 'c1',
      row: 0,
      col: 1,
      ownerUserId: 'u1',
      ownerUsername: 'arjun_m',
      ownerColor: getColorForUser('u1'),
    });
  });

  it("tells the map the capturer's username when a rival's cell is captured", async () => {
    const { prisma, territoryGateway, assignTerritory } = setup();
    prisma.territoryCell.findFirst
      .mockResolvedValueOnce(null) // nothing unclaimed left in the tier
      .mockResolvedValueOnce({ id: 'c2', territoryId: 't1', row: 3, col: 4, ownerships: [{ id: 'o9', userId: 'u2' }] });

    await assignTerritory('u1', 'OUTPOST');

    expect(prisma.territoryCellOwnership.update).toHaveBeenCalledWith({
      where: { id: 'o9' },
      data: { closedAt: expect.any(Date) },
    });
    expect(territoryGateway.broadcastCellUpdate).toHaveBeenCalledWith({
      territoryId: 't1',
      cellId: 'c2',
      row: 3,
      col: 4,
      ownerUserId: 'u1',
      ownerUsername: 'arjun_m',
      ownerColor: getColorForUser('u1'),
    });
  });
});

describe('SubmissionsProcessor and cells tied up in a duel', () => {
  it('does not look for a cell to capture among the ones in a pending or active duel', async () => {
    const { prisma, contestService, assignTerritory } = setup();
    contestService.lockedCellIds.mockResolvedValue(['staked-1', 'target-2']);
    prisma.territoryCell.findFirst.mockResolvedValue(null); // nothing free, nothing capturable

    await assignTerritory('u1', 'OUTPOST');

    expect(prisma.territoryCell.findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: expect.objectContaining({ id: { notIn: ['staked-1', 'target-2'] } }) }),
    );
    expect(prisma.territoryCellOwnership.update).not.toHaveBeenCalled();
  });

  // u1 holds (0,0); the cell next to it, (0,1), is a rival's
  const growSetup = (locked: string[]) => {
    const s = setup();
    s.prisma.territoryCellOwnership.findMany.mockResolvedValue([{ cell: { id: 'c0', territoryId: 't1', row: 0, col: 0 } }]);
    s.prisma.territoryCell.findMany.mockResolvedValue([
      { id: 'c0', territoryId: 't1', row: 0, col: 0, ownerships: [{ id: 'o0', userId: 'u1' }] },
      { id: 'c1', territoryId: 't1', row: 0, col: 1, ownerships: [{ id: 'o1', userId: 'u2' }] },
    ]);
    s.contestService.lockedCellIds.mockResolvedValue(locked);
    s.prisma.territoryCell.findFirst.mockResolvedValue(null);
    return s;
  };

  it('does not grow into a neighbouring rival cell that is tied up in a duel', async () => {
    const { prisma, assignTerritory } = growSetup(['c1']);

    await assignTerritory('u1', 'OUTPOST');

    expect(prisma.territoryCellOwnership.update).not.toHaveBeenCalled();
    expect(prisma.territoryCellOwnership.create).not.toHaveBeenCalled();
  });

  it('still captures that neighbour once it is free of any duel', async () => {
    const { prisma, assignTerritory } = growSetup([]);

    await assignTerritory('u1', 'OUTPOST');

    expect(prisma.territoryCellOwnership.update).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data: { closedAt: expect.any(Date) },
    });
  });
});


describe('SubmissionsProcessor and the map redraw', () => {
  it('never offers a retired cell: free-cell and capture searches both skip them', async () => {
    const { prisma, assignTerritory } = setup();
    prisma.territoryCell.findFirst.mockResolvedValue(null);
    await assignTerritory('u1', 'OUTPOST');
    for (const call of prisma.territoryCell.findFirst.mock.calls) {
      expect(call[0].where).toEqual(expect.objectContaining({ retiredAt: null }));
    }
  });

  it('only counts cells on the live grid as the ones a player already holds', async () => {
    const { prisma, assignTerritory } = setup();
    prisma.territoryCell.findFirst.mockResolvedValue(null);
    await assignTerritory('u1', 'OUTPOST');
    expect(prisma.territoryCellOwnership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', closedAt: null, cell: { territory: { tier: 'OUTPOST' }, retiredAt: null } } }),
    );
  });
});

describe('SubmissionsProcessor audit trail', () => {
  it('records who took a cell from whom when a solve captures a rival cell', async () => {
    const { prisma, audit, assignTerritory } = setup();
    prisma.territoryCell.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'c2', territoryId: 't1', row: 3, col: 4, ownerships: [{ id: 'o9', userId: 'u2' }] });

    await assignTerritory('u1', 'OUTPOST');

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'territory.transferred',
        actorId: 'u1',
        targetId: 'c2',
        metadata: expect.objectContaining({ sourceType: 'solve', fromUserId: 'u2', toUserId: 'u1' }),
      }),
    );
  });
});

describe('SubmissionsProcessor.process', () => {
  const submission = (extra: object = {}) => ({
    id: 's1',
    userId: 'u1',
    problemId: 7,
    code: 'print(1)',
    language: 'python',
    contestId: null,
    problem: { testCases: [{ input: { a: 1 }, expected_output: 1 }] },
    ...extra,
  });

  it('reads the code and the hidden tests from the database, since the job only carries an id', async () => {
    const { prisma, judge, processor } = setup();
    (prisma as Record<string, unknown>).submission = { findUnique: jest.fn().mockResolvedValue(submission()), update: jest.fn() };
    judge.runAllTestCases.mockResolvedValue({ verdict: 'WA', totalPassed: 0, totalTests: 1, results: [] });

    await processor.process({ data: { submissionId: 's1' } } as never);

    expect(judge.runAllTestCases).toHaveBeenCalledWith('print(1)', [{ input: { a: 1 }, expected_output: 1 }], 'python');
    const lookup = ((prisma as Record<string, any>).submission.findUnique as jest.Mock).mock.calls[0][0];
    expect(lookup.where).toEqual({ id: 's1' });
  });

  it('skips a job whose submission no longer exists', async () => {
    const { prisma, judge, processor } = setup();
    (prisma as Record<string, unknown>).submission = { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn() };
    await expect(processor.process({ data: { submissionId: 'gone' } } as never)).resolves.toBeUndefined();
    expect(judge.runAllTestCases).not.toHaveBeenCalled();
  });

  it('routes a duel submission to the contest, not to scoring or the map', async () => {
    const { prisma, judge, contestService, processor } = setup();
    const update = jest.fn();
    (prisma as Record<string, unknown>).submission = { findUnique: jest.fn().mockResolvedValue(submission({ contestId: 'k1' })), update };
    judge.runAllTestCases.mockResolvedValue({ verdict: 'AC', totalPassed: 1, totalTests: 1, results: [] });

    await processor.process({ data: { submissionId: 's1' } } as never);

    expect(contestService.handleSubmissionResult).toHaveBeenCalledWith('k1', 'u1', 's1', 'AC', 1, 1);
    expect(update).toHaveBeenCalledTimes(1);
  });
});
