import { colorFromIndex } from '../common/color/color.util';
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
    user: { findUnique: jest.fn().mockResolvedValue({ colorIndex: 3 }) },
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
    allocateCell(db: unknown, u: string, tier: string): Promise<Cell | null>;
  };
  const priv = processor as unknown as Priv;
  // a correct solve of an Easy problem: scores into the OUTPOST tier
  const accept = (userId: string) => priv.handleAcceptedSubmission('s1', userId, 1);
  const allocate = (userId: string, tier = 'OUTPOST') => priv.allocateCell(tx, userId, tier);
  return { prisma, tx, territoryGateway, leaderboardRedis, contestService, accept, allocate };
}

describe('SubmissionsProcessor territory broadcasts', () => {
  it('tells the map when a free cell is claimed', async () => {
    const { tx, territoryGateway, accept } = setup();
    tx.territoryCell.findFirst.mockResolvedValue({ id: 'c1', territoryId: 't1', row: 0, col: 1 });

    await accept('u1');

    // the ownership remembers which solve earned it, so the scoring tab can show it
    expect(tx.territoryCellOwnership.create).toHaveBeenCalledWith({
      data: { cellId: 'c1', userId: 'u1', sourceType: 'solve', submissionId: 's1', captured: false },
    });
    expect(territoryGateway.broadcastCellUpdate).toHaveBeenCalledWith({
      territoryId: 't1',
      cellId: 'c1',
      row: 0,
      col: 1,
      ownerId: 'u1',
      ownerColor: colorFromIndex(3),
    });
  });

  it("never takes a rival's cell: with the tier full it hands out free ground elsewhere", async () => {
    const { tx, territoryGateway, accept } = setup();
    tx.territoryCell.findFirst
      .mockResolvedValueOnce(null) // nothing free left in the tier
      .mockResolvedValueOnce({ id: 'c7', territoryId: 't2', row: 1, col: 1 }); // free in the next tier

    await accept('u1');

    expect(tx.territoryCellOwnership.update).not.toHaveBeenCalled();
    expect(tx.territoryCellOwnership.create).toHaveBeenCalledWith({
      data: { cellId: 'c7', userId: 'u1', sourceType: 'solve', submissionId: 's1', captured: false },
    });
    expect(territoryGateway.broadcastCellUpdate).toHaveBeenCalledWith(expect.objectContaining({ cellId: 'c7', ownerId: 'u1' }));
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

describe('SubmissionsProcessor and other players\' cells', () => {
  // u1 holds (0,0); the cell next to it, (0,1), is a rival's
  const rivalNextDoor = () => {
    const s = setup();
    s.tx.territoryCellOwnership.findMany.mockResolvedValue([{ cell: { id: 'c0', territoryId: 't1', row: 0, col: 0 } }]);
    s.tx.territoryCell.findMany.mockResolvedValue([
      { id: 'c0', territoryId: 't1', row: 0, col: 0, ownerships: [{ id: 'o0', userId: 'u1' }] },
      { id: 'c1', territoryId: 't1', row: 0, col: 1, ownerships: [{ id: 'o1', userId: 'u2' }] },
    ]);
    s.tx.territoryCell.findFirst.mockResolvedValue(null);
    return s;
  };

  it('never grows into a neighbouring rival cell', async () => {
    const { tx, allocate } = rivalNextDoor();

    expect(await allocate('u1')).toBeNull();

    expect(tx.territoryCellOwnership.update).not.toHaveBeenCalled();
    expect(tx.territoryCellOwnership.create).not.toHaveBeenCalled();
  });

  it('only ever looks for cells nobody holds', async () => {
    const { tx, allocate } = setup();
    tx.territoryCell.findFirst.mockResolvedValue(null);

    await allocate('u1', 'OUTPOST');

    for (const [query] of tx.territoryCell.findFirst.mock.calls) {
      expect(query.where.ownerships).toEqual({ none: { closedAt: null } });
    }
  });

  it('asks for the nearest other tiers next, lower ones first', async () => {
    const { tx, allocate } = setup();
    tx.territoryCell.findFirst.mockResolvedValue(null);

    await allocate('u1', 'STRONGHOLD');

    const asked = tx.territoryCell.findFirst.mock.calls.map(([q]) => q.where.territory.tier);
    expect(asked).toEqual(['STRONGHOLD', 'SETTLEMENT', 'CITADEL', 'OUTPOST']);
  });

  it('still awards the score when no cell is left anywhere, just without a cell', async () => {
    const { tx, territoryGateway, accept } = setup();
    tx.territoryCell.findFirst.mockResolvedValue(null);

    await expect(accept('u1')).resolves.toEqual({ awarded: true, reason: null });

    expect(tx.performanceScore.create).toHaveBeenCalled();
    expect(territoryGateway.broadcastCellUpdate).not.toHaveBeenCalled();
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
      data: { cellId: 'c9', userId: 'u1', sourceType: 'solve', captured: false },
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

  it('leaves rival cells alone even when nothing else is free', async () => {
    const { tx, allocate } = withFootprint([held('c0', 0, 0), rival('far', 3, 3), rival('next', 0, 1)]);

    expect(await allocate('u1')).toBeNull();

    expect(tx.territoryCellOwnership.update).not.toHaveBeenCalled();
    expect(tx.territoryCellOwnership.create).not.toHaveBeenCalled();
  });

  it('gives a player with no foothold yet a free cell, never a rival one', async () => {
    const s = setup();
    s.tx.territoryCell.findFirst.mockResolvedValue({ id: 'c5', territoryId: 't3', row: 0, col: 0 });

    expect((await s.allocate('u1'))?.id).toBe('c5');
    expect(s.tx.territoryCellOwnership.update).not.toHaveBeenCalled();
  });

  it('awards no cell when nothing on the map is free', async () => {
    const s = setup();
    s.tx.territoryCell.findFirst.mockResolvedValue(null);

    expect(await s.allocate('u1')).toBeNull();
    expect(s.tx.territoryCellOwnership.create).not.toHaveBeenCalled();
  });
});
