import { getColorForUser } from '../common/color/color.util';
import { ScoringService } from '../scoring/scoring.service';
import { SubmissionsProcessor } from './submissions.processor';

type Cell = { id: string; territoryId: string; row: number; col: number };
type OwnedCell = Cell & { ownerships: { id: string; userId: string }[] };

function makeDb() {
  return {
    territoryCellOwnership: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn(),
    },
    territoryCell: { findFirst: jest.fn(), findMany: jest.fn() },
    performanceScore: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(), aggregate: jest.fn() },
    dailyProgress: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
  };
}

function setup() {
  const tx = makeDb();
  const prisma = {
    ...makeDb(),
    problem: { findUnique: jest.fn().mockResolvedValue({ difficultyLevel: 'Easy' }) },
    submission: { count: jest.fn().mockResolvedValue(1) },
    // the award runs on `tx`, so a test can tell what was written inside it
    $transaction: jest.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  prisma.performanceScore.aggregate.mockResolvedValue({ _sum: { totalScore: 11 } });
  const territoryGateway = { broadcastCellUpdate: jest.fn(), broadcastLeaderboardUpdate: jest.fn() };
  const leaderboardRedis = { updateCollegeScore: jest.fn().mockResolvedValue(undefined) };
  const contestService = { lockedCellIds: jest.fn().mockResolvedValue([] as string[]) };
  const processor = new SubmissionsProcessor(
    prisma as never,
    null as never,
    new ScoringService() as never,
    leaderboardRedis as never,
    territoryGateway as never,
    contestService as never,
  );
  type Priv = {
    handleAcceptedSubmission(s: string, u: string, p: number): Promise<{ awarded: boolean; reason: string | null }>;
    allocateCell(db: unknown, u: string, tier: string, locked: string[]): Promise<Cell | null>;
  };
  const priv = processor as unknown as Priv;
  // a correct solve of an Easy problem: scores into the OUTPOST tier
  const accept = (userId: string) => priv.handleAcceptedSubmission('s1', userId, 1);
  const allocate = (userId: string, tier = 'OUTPOST', locked: string[] = []) => priv.allocateCell(tx, userId, tier, locked);
  return { prisma, tx, territoryGateway, leaderboardRedis, contestService, accept, allocate };
}

describe('SubmissionsProcessor territory broadcasts', () => {
  it('tells the map when a free cell is claimed', async () => {
    const { tx, territoryGateway, accept } = setup();
    tx.territoryCell.findFirst.mockResolvedValue({ id: 'c1', territoryId: 't1', row: 0, col: 1 });

    await accept('u1');

    expect(tx.territoryCellOwnership.create).toHaveBeenCalledWith({
      data: { cellId: 'c1', userId: 'u1', sourceType: 'solve' },
    });
    expect(territoryGateway.broadcastCellUpdate).toHaveBeenCalledWith({
      territoryId: 't1',
      cellId: 'c1',
      row: 0,
      col: 1,
      ownerId: 'u1',
      ownerColor: getColorForUser('u1'),
    });
  });

  it("tells the map when a rival's cell is captured", async () => {
    const { tx, territoryGateway, accept } = setup();
    tx.territoryCell.findFirst
      .mockResolvedValueOnce(null) // nothing unclaimed left in the tier
      .mockResolvedValueOnce({ id: 'c2', territoryId: 't1', row: 3, col: 4, ownerships: [{ id: 'o9', userId: 'u2' }] });

    await accept('u1');

    expect(tx.territoryCellOwnership.update).toHaveBeenCalledWith({
      where: { id: 'o9' },
      data: { closedAt: expect.any(Date) },
    });
    expect(territoryGateway.broadcastCellUpdate).toHaveBeenCalledWith({
      territoryId: 't1',
      cellId: 'c2',
      row: 3,
      col: 4,
      ownerId: 'u1',
      ownerColor: getColorForUser('u1'),
    });
  });
});

describe('SubmissionsProcessor award', () => {
  it('saves the score, the day count and the cell together, on the transaction', async () => {
    const { prisma, tx, accept } = setup();
    tx.territoryCell.findFirst.mockResolvedValue({ id: 'c1', territoryId: 't1', row: 0, col: 0 });

    await expect(accept('u1')).resolves.toEqual({ awarded: true, reason: null });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.performanceScore.create).toHaveBeenCalledTimes(1);
    expect(tx.dailyProgress.upsert).toHaveBeenCalledTimes(1);
    expect(tx.territoryCellOwnership.create).toHaveBeenCalledTimes(1);
    // none of it went around the transaction
    expect(prisma.performanceScore.create).not.toHaveBeenCalled();
    expect(prisma.dailyProgress.upsert).not.toHaveBeenCalled();
    expect(prisma.territoryCellOwnership.create).not.toHaveBeenCalled();
  });

  it('keeps the player from being paid without a cell: a failed cell write fails the whole award', async () => {
    const { tx, territoryGateway, leaderboardRedis, accept } = setup();
    tx.territoryCell.findFirst.mockResolvedValue({ id: 'c1', territoryId: 't1', row: 0, col: 0 });
    tx.territoryCellOwnership.create.mockRejectedValue(new Error('db went away'));

    await expect(accept('u1')).rejects.toThrow('db went away');

    // the error reaches the database transaction (which rolls the score back) and nobody is told anything
    expect(territoryGateway.broadcastCellUpdate).not.toHaveBeenCalled();
    expect(leaderboardRedis.updateCollegeScore).not.toHaveBeenCalled();
  });

  it('still gives the cell when the leaderboard cannot be updated', async () => {
    const { tx, territoryGateway, leaderboardRedis, accept } = setup();
    tx.territoryCell.findFirst.mockResolvedValue({ id: 'c1', territoryId: 't1', row: 0, col: 0 });
    leaderboardRedis.updateCollegeScore.mockRejectedValue(new Error('redis is down'));

    await expect(accept('u1')).resolves.toEqual({ awarded: true, reason: null });

    expect(tx.territoryCellOwnership.create).toHaveBeenCalled();
    expect(territoryGateway.broadcastCellUpdate).toHaveBeenCalledWith(expect.objectContaining({ cellId: 'c1', ownerId: 'u1' }));
  });
});

describe('SubmissionsProcessor and cells tied up in a duel', () => {
  it('does not look for a cell to capture among the ones in a pending or active duel', async () => {
    const { tx, allocate } = setup();
    tx.territoryCell.findFirst.mockResolvedValue(null); // nothing free, nothing capturable

    await allocate('u1', 'OUTPOST', ['staked-1', 'target-2']);

    expect(tx.territoryCell.findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: expect.objectContaining({ id: { notIn: ['staked-1', 'target-2'] } }) }),
    );
    expect(tx.territoryCellOwnership.update).not.toHaveBeenCalled();
  });

  it('reads the duel-locked cells once, before the award transaction opens', async () => {
    const { prisma, contestService, accept } = setup();
    contestService.lockedCellIds.mockImplementation(async () => {
      expect(prisma.$transaction).not.toHaveBeenCalled();
      return [];
    });

    await accept('u1');

    expect(contestService.lockedCellIds).toHaveBeenCalledTimes(1);
  });

  // u1 holds (0,0); the cell next to it, (0,1), is a rival's
  const growSetup = (locked: string[]) => {
    const s = setup();
    s.tx.territoryCellOwnership.findMany.mockResolvedValue([{ cell: { id: 'c0', territoryId: 't1', row: 0, col: 0 } }]);
    s.tx.territoryCell.findMany.mockResolvedValue([
      { id: 'c0', territoryId: 't1', row: 0, col: 0, ownerships: [{ id: 'o0', userId: 'u1' }] },
      { id: 'c1', territoryId: 't1', row: 0, col: 1, ownerships: [{ id: 'o1', userId: 'u2' }] },
    ]);
    s.tx.territoryCell.findFirst.mockResolvedValue(null);
    return { ...s, locked };
  };

  it('does not grow into a neighbouring rival cell that is tied up in a duel', async () => {
    const { tx, allocate, locked } = growSetup(['c1']);

    await allocate('u1', 'OUTPOST', locked);

    expect(tx.territoryCellOwnership.update).not.toHaveBeenCalled();
    expect(tx.territoryCellOwnership.create).not.toHaveBeenCalled();
  });

  it('still captures that neighbour once it is free of any duel', async () => {
    const { tx, allocate, locked } = growSetup([]);

    await allocate('u1', 'OUTPOST', locked);

    expect(tx.territoryCellOwnership.update).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data: { closedAt: expect.any(Date) },
    });
  });
});

describe('SubmissionsProcessor: a solve adds land before it takes any', () => {
  const held = (id: string, row: number, col: number): OwnedCell => ({ id, territoryId: 't1', row, col, ownerships: [{ id: `o-${id}`, userId: 'u1' }] });
  const rival = (id: string, row: number, col: number): OwnedCell => ({ id, territoryId: 't1', row, col, ownerships: [{ id: `o-${id}`, userId: 'u2' }] });
  const free = (id: string, row: number, col: number): OwnedCell => ({ id, territoryId: 't1', row, col, ownerships: [] });

  const withFootprint = (zone: OwnedCell[]) => {
    const s = setup();
    s.tx.territoryCellOwnership.findMany.mockResolvedValue(
      zone.filter((c) => c.ownerships[0]?.userId === 'u1').map((c) => ({ cell: c })),
    );
    s.tx.territoryCell.findMany.mockResolvedValue(zone);
    s.tx.territoryCell.findFirst.mockResolvedValue(null);
    return s;
  };

  it('claims a free cell elsewhere in the zone rather than take the rival cell next door', async () => {
    // u1 holds (0,0); (0,1) is a rival's; (2,2) is free but not adjacent
    const { tx, allocate } = withFootprint([held('c0', 0, 0), rival('c1', 0, 1), free('c9', 2, 2)]);

    const cell = await allocate('u1');

    expect(cell?.id).toBe('c9');
    expect(tx.territoryCellOwnership.update).not.toHaveBeenCalled();
    expect(tx.territoryCellOwnership.create).toHaveBeenCalledWith({
      data: { cellId: 'c9', userId: 'u1', sourceType: 'solve' },
    });
  });

  it('prefers a free cell that touches what it already holds', async () => {
    const { allocate } = withFootprint([held('c0', 1, 1), free('far', 0, 0), free('next', 1, 2)]);

    expect((await allocate('u1'))?.id).toBe('next');
  });

  it('claims a free cell in another zone of the tier rather than take a rival cell next door', async () => {
    const { tx, allocate } = withFootprint([held('c0', 0, 0), rival('c1', 0, 1)]);
    tx.territoryCell.findFirst.mockResolvedValueOnce({ id: 'elsewhere', territoryId: 't2', row: 0, col: 0 });

    const cell = await allocate('u1');

    expect(cell?.id).toBe('elsewhere');
    expect(tx.territoryCellOwnership.update).not.toHaveBeenCalled();
  });

  it('takes a rival cell only once nothing in the tier is free, and prefers one next door', async () => {
    const { tx, allocate } = withFootprint([held('c0', 0, 0), rival('far', 3, 3), rival('next', 0, 1)]);

    const cell = await allocate('u1');

    expect(cell?.id).toBe('next');
    expect(tx.territoryCellOwnership.update).toHaveBeenCalledWith({
      where: { id: 'o-next' },
      data: { closedAt: expect.any(Date) },
    });
  });

  it('gives a player with no foothold yet a free cell, never a rival one', async () => {
    const s = setup();
    s.tx.territoryCell.findFirst.mockResolvedValue({ id: 'c5', territoryId: 't3', row: 0, col: 0 });

    expect((await s.allocate('u1'))?.id).toBe('c5');
    expect(s.tx.territoryCellOwnership.update).not.toHaveBeenCalled();
  });

  it('says so, and awards no cell, when the tier has nothing the player can take', async () => {
    const s = setup();
    s.tx.territoryCell.findFirst.mockResolvedValue(null);

    expect(await s.allocate('u1')).toBeNull();
    expect(s.tx.territoryCellOwnership.create).not.toHaveBeenCalled();
  });
});
