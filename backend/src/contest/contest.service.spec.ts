import { getColorForUser } from '../common/color/color.util';
import { ContestService } from './contest.service';

function setup() {
  const prisma = {
    contest: { findMany: jest.fn(), findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  const problemsService = { findOne: jest.fn().mockResolvedValue({ id: 1, title: 'Two Sum' }) };
  const territoryGateway = { broadcastCellUpdate: jest.fn() };
  const service = new ContestService(
    prisma as never,
    problemsService as never,
    territoryGateway as never,
    null as never,
    null as never,
    null as never,
  );
  return { prisma, territoryGateway, service };
}

const contestRow = {
  id: 'k1',
  status: 'PENDING',
  durationSeconds: 600,
  winnerId: null,
  endReason: null,
  createdAt: new Date('2026-10-04T10:00:00Z'),
  startedAt: null,
  endedAt: null,
  cell: { id: 'c1', row: 1, col: 2, territoryId: 't1', territory: { name: 'M Hostel', tier: 'SETTLEMENT' } },
  problem: { id: 1, title: 'Two Sum', difficultyLevel: 'Easy' },
  challenger: { id: 'u1', username: 'arjun_m' },
  defender: { id: 'u2', username: 'player_a1b2c3' },
};

describe('ContestService player names', () => {
  it('lists challenges with both players named by username', async () => {
    const { prisma, service } = setup();
    prisma.contest.findMany.mockResolvedValue([contestRow]);

    const [challenge] = await service.listIncoming('u2');

    expect(challenge.challenger).toEqual({ id: 'u1', name: 'arjun_m' });
    expect(challenge.defender).toEqual({ id: 'u2', name: 'player_a1b2c3' });
  });

  it('selects only id and username of the players, never email or real name', async () => {
    const { prisma, service } = setup();
    prisma.contest.findMany.mockResolvedValue([]);

    await service.listIncoming('u2');

    expect(prisma.contest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          challenger: { select: { id: true, username: true } },
          defender: { select: { id: true, username: true } },
        }),
      }),
    );
  });

  it('names both players by username in a single contest too', async () => {
    const { prisma, service } = setup();
    prisma.contest.findUnique.mockResolvedValue({ ...contestRow, challengerId: 'u1', defenderId: 'u2', problemId: 1, participants: [] });

    const contest = await service.getContest('k1', 'u1');

    expect(contest.challenger).toEqual({ id: 'u1', name: 'arjun_m' });
    expect(contest.defender).toEqual({ id: 'u2', name: 'player_a1b2c3' });
    expect(prisma.contest.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          challenger: { select: { id: true, username: true } },
          defender: { select: { id: true, username: true } },
        }),
      }),
    );
  });
});

describe('ContestService.transferCell', () => {
  it("tells the map the new owner's username", async () => {
    const { prisma, territoryGateway, service } = setup();
    const tx = {
      territoryCellOwnership: {
        findFirst: jest.fn().mockResolvedValue({ id: 'o1', userId: 'u2' }),
        update: jest.fn(),
        create: jest.fn().mockResolvedValue({ cell: { territoryId: 't1', row: 1, col: 2 }, user: { username: 'arjun_m' } }),
      },
    };
    prisma.$transaction.mockImplementation((work: (t: typeof tx) => unknown) => work(tx));

    const moved = await (
      service as unknown as { transferCell(cellId: string, from: string, to: string): Promise<boolean> }
    ).transferCell('c1', 'u2', 'u1');

    expect(moved).toBe(true);
    expect(tx.territoryCellOwnership.create).toHaveBeenCalledWith({
      data: { cellId: 'c1', userId: 'u1', sourceType: 'contest' },
      include: { cell: true, user: { select: { username: true } } },
    });
    expect(territoryGateway.broadcastCellUpdate).toHaveBeenCalledWith({
      territoryId: 't1',
      cellId: 'c1',
      row: 1,
      col: 2,
      ownerId: 'u1',
      ownerUsername: 'arjun_m',
      ownerColor: getColorForUser('u1'),
    });
  });
});
