import { UnauthorizedException } from '@nestjs/common';
import { getColorForUser } from '../common/color/color.util';
import type { AuthUser } from '../auth/auth-user';
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
  const controller = new LeaderboardController(redis as unknown as LeaderboardRedisService, prisma as unknown as PrismaService);
  return { redis, prisma, controller };
}

const me: AuthUser = { userId: 'u1', role: 'USER', isGuest: false };
const guest: AuthUser = { userId: 'guest:abc', role: 'GUEST', isGuest: true };

describe('LeaderboardController rows', () => {
  it('shows a handle and a score, plus whether the row is the viewer: no id, no name, no email', async () => {
    const { redis, prisma, controller } = setup();
    redis.getCollegeTop.mockResolvedValue([
      { userId: 'u1', score: 90 },
      { userId: 'u2', score: 50 },
    ]);
    prisma.user.findMany.mockResolvedValue([
      { id: 'u1', username: 'arjun_m' },
      { id: 'u2', username: 'player_a1b2c3' },
    ]);

    const rows = await controller.getCollegeLeaderboard({}, me);

    expect(rows).toEqual([
      { username: 'arjun_m', score: 90, isMe: true, color: getColorForUser('u1') },
      { username: 'player_a1b2c3', score: 50, isMe: false, color: getColorForUser('u2') },
    ]);
    expect(JSON.stringify(rows)).not.toMatch(/u1|u2|userId|email/);
    // the query itself cannot return an email or a real name
    expect(prisma.user.findMany).toHaveBeenCalledWith({ where: { id: { in: ['u1', 'u2'] } }, select: { id: true, username: true } });
  });

  it('never marks a row as the viewer for a demo session', async () => {
    const { redis, prisma, controller } = setup();
    redis.getCollegeTop.mockResolvedValue([{ userId: 'u1', score: 90 }]);
    prisma.user.findMany.mockResolvedValue([{ id: 'u1', username: 'arjun_m' }]);
    await expect(controller.getCollegeLeaderboard({}, guest)).resolves.toEqual([{ username: 'arjun_m', score: 90, isMe: false, color: getColorForUser('u1') }]);
  });

  it('uses usernames on a zone leaderboard too', async () => {
    const { redis, prisma, controller } = setup();
    redis.getTerritoryTop.mockResolvedValue([{ userId: 'u1', score: 12 }]);
    prisma.user.findMany.mockResolvedValue([{ id: 'u1', username: 'arjun_m' }]);
    await expect(controller.getTerritoryLeaderboard('t1', {}, me)).resolves.toEqual([{ username: 'arjun_m', score: 12, isMe: true, color: getColorForUser('u1') }]);
  });

  it('drops a player who no longer exists instead of showing a piece of their id', async () => {
    const { redis, prisma, controller } = setup();
    redis.getCollegeTop.mockResolvedValue([{ userId: '12345678-aaaa-bbbb-cccc-1234567890ab', score: 5 }]);
    prisma.user.findMany.mockResolvedValue([]);
    await expect(controller.getCollegeLeaderboard({}, me)).resolves.toEqual([]);
  });

  it('returns nothing for an empty board without touching the database', async () => {
    const { redis, prisma, controller } = setup();
    redis.getCollegeTop.mockResolvedValue([]);
    await expect(controller.getCollegeLeaderboard({}, me)).resolves.toEqual([]);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
});

describe('LeaderboardController access', () => {
  it('lets an anonymous caller see only the single top row (the login page teaser)', async () => {
    const { redis, prisma, controller } = setup();
    redis.getCollegeTop.mockResolvedValue([{ userId: 'u1', score: 90 }]);
    prisma.user.findMany.mockResolvedValue([{ id: 'u1', username: 'arjun_m' }]);

    await expect(controller.getCollegeLeaderboard({ limit: 1 })).resolves.toEqual([{ username: 'arjun_m', score: 90, isMe: false, color: getColorForUser('u1') }]);
    expect(redis.getCollegeTop).toHaveBeenCalledWith(1);
    await expect(controller.getCollegeLeaderboard({ limit: 50 })).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.getCollegeLeaderboard({})).rejects.toBeInstanceOf(UnauthorizedException); // the default page is 50
  });
});

describe('LeaderboardController /me routes', () => {
  it('answers about the caller only, from the token', async () => {
    const { redis, controller } = setup();
    redis.getCollegeRank.mockResolvedValue(3);
    await expect(controller.getMyRank(me)).resolves.toEqual({ rank: 3 });
    expect(redis.getCollegeRank).toHaveBeenCalledWith('u1');
  });

  it('gives a demo session an empty rank and nudge without asking Redis', async () => {
    const { redis, controller } = setup();
    await expect(controller.getMyRank(guest)).resolves.toEqual({ rank: null });
    await expect(controller.getMyNearMiss(guest)).resolves.toEqual({ rank: null, pointsToNext: 0, nextRankName: null });
    expect(redis.getCollegeRank).not.toHaveBeenCalled();
  });

  it('names the next player up by username in the near-miss nudge', async () => {
    const { redis, prisma, controller } = setup();
    redis.getCollegeRank.mockResolvedValue(3);
    redis.getCollegeScore.mockResolvedValue(40);
    redis.getCollegeEntryAtRank.mockResolvedValue({ userId: 'u2', score: 55 });
    prisma.user.findMany.mockResolvedValue([{ id: 'u2', username: 'riya_k' }]);

    await expect(controller.getMyNearMiss(me)).resolves.toEqual({ rank: 3, pointsToNext: 15, nextRankName: 'riya_k' });
    expect(redis.getCollegeEntryAtRank).toHaveBeenCalledWith(1); // the player one place above rank 3
  });

  it('has no nudge for the leader or an unranked player', async () => {
    const { redis, controller } = setup();
    redis.getCollegeRank.mockResolvedValue(1);
    await expect(controller.getMyNearMiss(me)).resolves.toEqual({ rank: 1, pointsToNext: 0, nextRankName: null });
    redis.getCollegeRank.mockResolvedValue(null);
    await expect(controller.getMyNearMiss(me)).resolves.toEqual({ rank: null, pointsToNext: 0, nextRankName: null });
  });
});
