import type { PrismaService } from '../prisma/prisma.service';
import { TerritoryService } from './territory.service';

function setup() {
  const prisma = {
    territory: { findMany: jest.fn() },
    territoryCell: { findMany: jest.fn() },
  };
  return { prisma, service: new TerritoryService(prisma as unknown as PrismaService) };
}

// The map may only ever learn the owner's username: no email, no real name.
const usernameOnlyQuery = {
  include: {
    ownerships: { where: { closedAt: null }, include: { user: { select: { username: true } } } },
  },
};

describe('TerritoryService.findAllCells', () => {
  it('gives each owned cell its owner username, and unclaimed cells none', async () => {
    const { prisma, service } = setup();
    prisma.territoryCell.findMany.mockResolvedValue([
      { id: 'c1', territoryId: 't1', row: 0, col: 0, ownerships: [{ userId: 'u1', user: { username: 'arjun_m' } }] },
      { id: 'c2', territoryId: 't1', row: 0, col: 1, ownerships: [] },
    ]);

    const cells = await service.findAllCells();

    expect(cells[0]).toMatchObject({ id: 'c1', ownerId: 'u1', ownerUsername: 'arjun_m' });
    expect(cells[1]).toMatchObject({ id: 'c2', ownerId: null, ownerUsername: null });
  });

  it('asks the database for the owner username only', async () => {
    const { prisma, service } = setup();
    prisma.territoryCell.findMany.mockResolvedValue([]);

    await service.findAllCells();

    expect(prisma.territoryCell.findMany).toHaveBeenCalledWith(usernameOnlyQuery);
  });
});

describe('TerritoryService.findAll', () => {
  it('gives an owned territory its owner username, and an unclaimed one none', async () => {
    const { prisma, service } = setup();
    prisma.territory.findMany.mockResolvedValue([
      { id: 't1', name: 'M Hostel', svgPathId: 'm-hostel', tier: 'SETTLEMENT', ownerships: [{ userId: 'u1', user: { username: 'arjun_m' } }] },
      { id: 't2', name: 'D Hostel', svgPathId: 'd-hostel', tier: 'STRONGHOLD', ownerships: [] },
    ]);

    const territories = await service.findAll();

    expect(territories[0]).toMatchObject({ id: 't1', ownerId: 'u1', ownerUsername: 'arjun_m' });
    expect(territories[1]).toMatchObject({ id: 't2', ownerId: null, ownerUsername: null });
  });

  it('asks the database for the owner username only', async () => {
    const { prisma, service } = setup();
    prisma.territory.findMany.mockResolvedValue([]);

    await service.findAll();

    expect(prisma.territory.findMany).toHaveBeenCalledWith(usernameOnlyQuery);
  });
});
