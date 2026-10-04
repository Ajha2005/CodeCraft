import { getColorForUser } from '../common/color/color.util';
import { SubmissionsProcessor } from './submissions.processor';

function setup() {
  const prisma = {
    territoryCellOwnership: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ user: { username: 'arjun_m' } }),
      update: jest.fn(),
    },
    territoryCell: { findFirst: jest.fn() },
  };
  const territoryGateway = { broadcastCellUpdate: jest.fn() };
  const processor = new SubmissionsProcessor(
    prisma as never,
    null as never,
    null as never,
    null as never,
    territoryGateway as never,
    null as never,
  );
  const assignTerritory = (userId: string, tier: string) =>
    (processor as unknown as { assignTerritory(u: string, t: string): Promise<void> }).assignTerritory(userId, tier);
  return { prisma, territoryGateway, assignTerritory };
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
