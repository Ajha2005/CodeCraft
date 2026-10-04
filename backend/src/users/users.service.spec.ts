import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

function setup() {
  const prisma = {
    user: { findUnique: jest.fn() },
    performanceScore: { aggregate: jest.fn().mockResolvedValue({ _sum: { totalScore: null } }) },
    territoryCellOwnership: { findMany: jest.fn().mockResolvedValue([]) },
    submission: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return { prisma, service: new UsersService(prisma as unknown as PrismaService) };
}

const joined = new Date('2026-09-01T10:00:00Z');
const row = { id: 'u1', username: 'arjun_m', createdAt: joined };

describe('UsersService.getPublicProfile', () => {
  it('finds the player whatever the casing of the link', async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(row);

    const profile = await service.getPublicProfile('Arjun_M');

    expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { username: 'arjun_m' } }));
    expect(profile.username).toBe('arjun_m');
  });

  it('adds up score, cells, territories and solved problems', async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(row);
    prisma.performanceScore.aggregate.mockResolvedValue({ _sum: { totalScore: 112.4 } });
    prisma.territoryCellOwnership.findMany.mockResolvedValue([
      { cell: { territoryId: 't1' } },
      { cell: { territoryId: 't1' } },
      { cell: { territoryId: 't2' } },
    ]);
    prisma.submission.findMany.mockResolvedValue([{ problemId: 1 }, { problemId: 7 }]);

    await expect(service.getPublicProfile('arjun_m')).resolves.toEqual({
      userId: 'u1',
      username: 'arjun_m',
      totalScore: 112.4,
      cellsHeld: 3,
      territoriesHeld: 2,
      problemsSolved: 2,
      joinedAt: joined,
    });
  });

  it('gives a brand new player zeros', async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(row);

    const profile = await service.getPublicProfile('arjun_m');

    expect(profile).toMatchObject({ totalScore: 0, cellsHeld: 0, territoriesHeld: 0, problemsSolved: 0 });
  });

  it('counts only cells held right now, and a problem once however often it was accepted', async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(row);

    await service.getPublicProfile('arjun_m');

    expect(prisma.territoryCellOwnership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', closedAt: null } }),
    );
    expect(prisma.submission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', verdict: 'AC' }, distinct: ['problemId'] }),
    );
  });

  it('shows nothing but the public fields', async () => {
    const { prisma, service } = setup();
    // even if the database handed back more, only the whitelisted fields leave
    prisma.user.findUnique.mockResolvedValue({ ...row, email: 'secret@thapar.edu', passwordHash: 'x', name: 'Real Name', flavorTextEnabled: true });

    const profile = await service.getPublicProfile('arjun_m');

    expect(Object.keys(profile).sort()).toEqual(
      ['cellsHeld', 'joinedAt', 'problemsSolved', 'territoriesHeld', 'totalScore', 'userId', 'username'].sort(),
    );
    expect(JSON.stringify(profile)).not.toMatch(/secret|Real Name|passwordHash/);
  });

  it('asks the database for id, username and join date only', async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(row);

    await service.getPublicProfile('arjun_m');

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { username: 'arjun_m' },
      select: { id: true, username: true, createdAt: true },
    });
  });

  it('is a 404 for a username nobody has', async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.getPublicProfile('nobody_here')).rejects.toThrow(new NotFoundException('User not found'));
  });

  it.each(['', 'ab', 'a'.repeat(21), 'bad name', 'dot.name', 'émile', 'a\u0000b', '@arjun', 'arjun/m'])(
    'is a 404 without a database call for something that cannot be a username (%j)',
    async (value) => {
      const { prisma, service } = setup();

      await expect(service.getPublicProfile(value)).rejects.toThrow(NotFoundException);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    },
  );
});
