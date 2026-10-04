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
  const territoryGateway = { broadcastCellUpdate: jest.fn() };
  const contestService = { lockedCellIds: jest.fn().mockResolvedValue([] as string[]) };
  const processor = new SubmissionsProcessor(
    prisma as never,
    null as never,
    null as never,
    null as never,
    territoryGateway as never,
    contestService as never,
  );
  const assignTerritory = (userId: string, tier: string) =>
    (processor as unknown as { assignTerritory(u: string, t: string): Promise<void> }).assignTerritory(userId, tier);
  return { prisma, territoryGateway, contestService, assignTerritory };
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
      ownerId: 'u1',
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
      ownerId: 'u1',
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
