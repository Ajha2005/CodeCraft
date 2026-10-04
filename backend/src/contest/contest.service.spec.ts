import 'reflect-metadata';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { getColorForUser } from '../common/color/color.util';
import { ContestService } from './contest.service';
import { CreateChallengeDto } from './dto/create-challenge.dto';

function setup() {
  const prisma = {
    contest: { findMany: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const problemsService = { findOne: jest.fn().mockResolvedValue({ id: 1, title: 'Two Sum' }) };
  const territoryGateway = { broadcastCellUpdate: jest.fn() };
  const contestGateway = { notifyUser: jest.fn(), broadcastToContest: jest.fn() };
  const timeoutQueue = { add: jest.fn().mockResolvedValue(undefined) };
  const service = new ContestService(
    prisma as never,
    problemsService as never,
    territoryGateway as never,
    contestGateway as never,
    null as never,
    timeoutQueue as never,
  );
  return { prisma, territoryGateway, contestGateway, timeoutQueue, service };
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

// ------------------------------------------------------------------ the stake

describe('ContestService.createChallenge (the pledged cell)', () => {
  type Cell = { id: string; ownerships: { userId: string }[] };
  const cells: Record<string, Cell> = {
    target: { id: 'target', ownerships: [{ userId: 'def' }] }, // held by the defender
    mine: { id: 'mine', ownerships: [{ userId: 'chal' }] }, // held by the challenger
    free: { id: 'free', ownerships: [] },
  };
  const dto = { cellId: 'target', pledgedCellId: 'mine', problemId: 5 };

  function challengeSetup() {
    const s = setup();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      territoryCell: { findUnique: jest.fn(({ where }: { where: { id: string } }) => Promise.resolve(cells[where.id] ?? null)) },
      contest: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(({ data }: { data: object }) => Promise.resolve({ id: 'k1', ...data })),
      },
      problem: { findUnique: jest.fn().mockResolvedValue({ id: 5 }) },
    };
    s.prisma.$transaction.mockImplementation((work: (t: typeof tx) => unknown) => work(tx));
    jest.spyOn(s.service, 'getContest').mockResolvedValue({ id: 'k1' } as never);
    return { ...s, tx };
  }

  it('records the stake on the duel and tells the defender', async () => {
    const { service, tx, timeoutQueue, contestGateway } = challengeSetup();

    await service.createChallenge('chal', dto);

    expect(tx.contest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ cellId: 'target', pledgedCellId: 'mine', challengerId: 'chal', defenderId: 'def' }),
    });
    expect(timeoutQueue.add).toHaveBeenCalledWith('expire-pending', { contestId: 'k1' }, expect.any(Object));
    expect(contestGateway.notifyUser).toHaveBeenCalledWith('def', 'challenge:received', { contestId: 'k1' });
  });

  it('locks both cells before it checks anything', async () => {
    const { service, tx } = challengeSetup();

    await service.createChallenge('chal', dto);

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.territoryCell.findUnique.mock.invocationCallOrder[0]);
  });

  it.each([
    ['one the challenger does not hold', { ...dto, pledgedCellId: 'target' }],
    ['one nobody holds', { ...dto, pledgedCellId: 'free' }],
    ['one that does not exist', { ...dto, pledgedCellId: 'ghost' }],
  ])('refuses a stake that is %s', async (_label, bad) => {
    const { service, tx, timeoutQueue } = challengeSetup();

    await expect(service.createChallenge('chal', bad)).rejects.toThrow(new BadRequestException('You can only pledge a cell you hold right now'));
    expect(tx.contest.create).not.toHaveBeenCalled();
    expect(timeoutQueue.add).not.toHaveBeenCalled();
  });

  it('refuses a stake that is already at stake in another open duel', async () => {
    const { service, tx } = challengeSetup();
    tx.contest.findMany.mockResolvedValue([{ cellId: 'elsewhere', pledgedCellId: 'mine' }]);

    await expect(service.createChallenge('chal', dto)).rejects.toThrow(
      new ConflictException('The cell you pledged is already at stake in another duel'),
    );
    expect(tx.contest.create).not.toHaveBeenCalled();
  });

  it('refuses a stake that is the target of another open duel', async () => {
    const { service, tx } = challengeSetup();
    tx.contest.findMany.mockResolvedValue([{ cellId: 'mine', pledgedCellId: 'theirs' }]);

    await expect(service.createChallenge('chal', dto)).rejects.toThrow(ConflictException);
  });

  it('refuses to challenge a cell that is staked in another open duel', async () => {
    const { service, tx } = challengeSetup();
    tx.contest.findMany.mockResolvedValue([{ cellId: 'elsewhere', pledgedCellId: 'target' }]);

    await expect(service.createChallenge('chal', dto)).rejects.toThrow(
      new ConflictException('This cell already has a pending or active contest'),
    );
  });

  it('only counts duels that are still open', async () => {
    const { service, tx } = challengeSetup();

    await service.createChallenge('chal', dto);

    expect(tx.contest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: { in: ['PENDING', 'ACTIVE'] } }) }),
    );
  });

  it('keeps the old rules: nothing to contest on a free cell, none on your own', async () => {
    const { service } = challengeSetup();

    await expect(service.createChallenge('chal', { ...dto, cellId: 'free' })).rejects.toThrow(BadRequestException);
    await expect(service.createChallenge('def', dto)).rejects.toThrow(new BadRequestException('You already hold this cell'));
  });
});

describe('CreateChallengeDto', () => {
  const errorsFor = (value: object) => validate(plainToInstance(CreateChallengeDto, value)).then((e) => e.map((x) => x.property));

  it('requires the cell to stake', async () => {
    expect(await errorsFor({ cellId: 'target' })).toContain('pledgedCellId');
    expect(await errorsFor({ cellId: 'target', pledgedCellId: 'mine' })).toEqual([]);
  });
});

// ------------------------------------------------------------ how a duel ends

describe('ContestService: who ends up with which cell', () => {
  const duel = { id: 'k1', cellId: 'target', pledgedCellId: 'mine', challengerId: 'chal', defenderId: 'def' };

  function endSetup(row: object = duel) {
    const s = setup();
    s.prisma.contest.updateMany.mockResolvedValue({ count: 1 });
    s.prisma.contest.findUnique.mockResolvedValue(row);
    const move = jest.fn().mockResolvedValue(true);
    (s.service as unknown as { transferCell: typeof move }).transferCell = move;
    const end = (winnerId: string | null, reason: string) =>
      (s.service as unknown as { resolveContest(id: string, w: string | null, r: string): Promise<void> }).resolveContest('k1', winnerId, reason);
    return { ...s, move, end };
  }

  it('challenger wins: takes the contested cell and keeps the one they staked', async () => {
    const { move, end, contestGateway } = endSetup();

    await end('chal', 'AC');

    expect(move).toHaveBeenCalledTimes(1);
    expect(move).toHaveBeenCalledWith('target', 'def', 'chal');
    expect(contestGateway.broadcastToContest).toHaveBeenCalledWith(
      'k1',
      'contest:ended',
      expect.objectContaining({ transferred: true, pledgeTransferred: false }),
    );
  });

  it('defender wins: keeps their cell and takes the one the challenger staked', async () => {
    const { move, end, contestGateway } = endSetup();

    await end('def', 'AC');

    expect(move).toHaveBeenCalledTimes(1);
    expect(move).toHaveBeenCalledWith('mine', 'chal', 'def');
    expect(contestGateway.broadcastToContest).toHaveBeenCalledWith(
      'k1',
      'contest:ended',
      expect.objectContaining({ transferred: false, pledgeTransferred: true }),
    );
  });

  it('a defender win by the challenger forfeiting costs the stake too', async () => {
    const { move, end } = endSetup();

    await end('def', 'FORFEIT');

    expect(move).toHaveBeenCalledWith('mine', 'chal', 'def');
  });

  it('a draw moves nothing', async () => {
    const { move, end, contestGateway } = endSetup();

    await end(null, 'DRAW');

    expect(move).not.toHaveBeenCalled();
    expect(contestGateway.broadcastToContest).toHaveBeenCalledWith(
      'k1',
      'contest:ended',
      expect.objectContaining({ transferred: false, pledgeTransferred: false }),
    );
  });

  it('a duel made before pledging existed has no stake to take', async () => {
    const { move, end } = endSetup({ ...duel, pledgedCellId: null });

    await end('def', 'AC');

    expect(move).not.toHaveBeenCalled();
  });

  it('only the first result counts (a duel already resolved moves nothing)', async () => {
    const { prisma, move, end, contestGateway } = endSetup();
    prisma.contest.updateMany.mockResolvedValue({ count: 0 });

    await end('def', 'TIMEOUT');

    expect(move).not.toHaveBeenCalled();
    expect(contestGateway.broadcastToContest).not.toHaveBeenCalled();
  });
});

describe('ContestService.lockedCellIds', () => {
  it('lists the target and the stake of every open duel, and only those', async () => {
    const { prisma, service } = setup();
    prisma.contest.findMany.mockResolvedValue([
      { cellId: 'a', pledgedCellId: 'b' },
      { cellId: 'c', pledgedCellId: null }, // made before pledging existed
    ]);

    await expect(service.lockedCellIds()).resolves.toEqual(['a', 'b', 'c']);
    expect(prisma.contest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: { in: ['PENDING', 'ACTIVE'] } } }),
    );
  });
});

describe('ContestService: the stake in what players see', () => {
  it('shows the staked cell on a challenge, and null on a duel without one', async () => {
    const { prisma, service } = setup();
    const staked = { id: 'mine', row: 3, col: 4, territoryId: 't2', territory: { name: 'Q Hostel', tier: 'OUTPOST' } };
    prisma.contest.findMany.mockResolvedValue([{ ...contestRow, pledgedCell: staked }, { ...contestRow, id: 'k0', pledgedCell: null }]);

    const [withStake, without] = await service.listIncoming('u2');

    expect(withStake.pledgedCell).toEqual({ id: 'mine', row: 3, col: 4, territoryId: 't2', territoryName: 'Q Hostel', tier: 'OUTPOST' });
    expect(without.pledgedCell).toBeNull();
  });

  it('asks for the staked cell along with the contested one', async () => {
    const { prisma, service } = setup();
    prisma.contest.findMany.mockResolvedValue([]);

    await service.listIncoming('u2');

    expect(prisma.contest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ include: expect.objectContaining({ pledgedCell: { include: { territory: true } } }) }),
    );
  });
});
