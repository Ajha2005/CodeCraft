import type { LeaderboardRedisService } from '../common/redis/leaderboard-redis.service';
import type { PrismaService } from '../prisma/prisma.service';
import { LeaderboardController } from './leaderboard.controller';

function setup() {
  const redis = {
    getCollegeTop: jest.fn(),
    getTerritoryTop: jest.fn(),
    getCollegeRank: jest.fn(),
    getCollegeScore: jest.fn(),
    getCollegeEntryAtRank: jest.fn(),
  };
  const prisma = { user: { findMany: jest.fn() } };
  const controller = new LeaderboardController(
    redis as unknown as LeaderboardRedisService,
    prisma as unknown as PrismaService,
  );
  return { redis, prisma, controller };
}

describe('LeaderboardController names', () => {
  it('shows each player under the name they signed in with, else the start of their email', async () => {
    const { redis, prisma, controller } = setup();
    redis.getCollegeTop.mockResolvedValue([
      { userId: 'u1', score: 90 },
      { userId: 'u2', score: 50 },
    ]);
    prisma.user.findMany.mockResolvedValue([
      { id: 'u1', name: ' Arjun Mehta ', email: 'arjun@thapar.edu' },
      { id: 'u2', name: null, email: 'riya.sharma@thapar.edu' },
    ]);

    await expect(controller.getCollegeLeaderboard()).resolves.toEqual([
      { userId: 'u1', name: 'Arjun Mehta', score: 90 },
      { userId: 'u2', name: 'riya.sharma', score: 50 },
    ]);
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['u1', 'u2'] } },
      select: { id: true, name: true, email: true },
    });
  });

  it('names players the same way on a zone leaderboard', async () => {
    const { redis, prisma, controller } = setup();
    redis.getTerritoryTop.mockResolvedValue([{ userId: 'u1', score: 12 }]);
    prisma.user.findMany.mockResolvedValue([{ id: 'u1', name: 'Arjun Mehta', email: 'arjun@thapar.edu' }]);

    await expect(controller.getTerritoryLeaderboard('t1')).resolves.toEqual([
      { userId: 'u1', name: 'Arjun Mehta', score: 12 },
    ]);
  });

  it('shows a short id for a player who no longer exists', async () => {
    const { redis, prisma, controller } = setup();
    redis.getCollegeTop.mockResolvedValue([{ userId: '12345678-aaaa-bbbb-cccc-1234567890ab', score: 5 }]);
    prisma.user.findMany.mockResolvedValue([]);

    const [entry] = await controller.getCollegeLeaderboard();

    expect(entry.name).toBe('12345678');
  });

  it('names the next player up in the near-miss nudge', async () => {
    const { redis, prisma, controller } = setup();
    redis.getCollegeRank.mockResolvedValue(3);
    redis.getCollegeScore.mockResolvedValue(40);
    redis.getCollegeEntryAtRank.mockResolvedValue({ userId: 'u9', score: 55 });
    prisma.user.findMany.mockResolvedValue([{ id: 'u9', name: 'Rival Nine', email: 'rival9@thapar.edu' }]);

    await expect(controller.getNearMiss('u1')).resolves.toEqual({ rank: 3, pointsToNext: 15, nextRankName: 'Rival Nine' });
  });

  it('returns nothing for an empty board without touching the database', async () => {
    const { redis, prisma, controller } = setup();
    redis.getCollegeTop.mockResolvedValue([]);

    await expect(controller.getCollegeLeaderboard()).resolves.toEqual([]);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
});
