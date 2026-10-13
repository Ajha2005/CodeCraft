import { getColorForUser, UNCLAIMED_COLOR } from '../common/color/color.util';
import type { PrismaService } from '../prisma/prisma.service';
import { TerritoryService } from './territory.service';

function setup() {
  const prisma = {
    territory: { findMany: jest.fn() },
    territoryCell: { findMany: jest.fn() },
  };
  return { prisma, service: new TerritoryService(prisma as unknown as PrismaService) };
}

// Only open ownerships count; a closed one means the cell has changed hands since.
const openOwnershipsQuery = { include: { ownerships: { where: { closedAt: null } } } };

describe('TerritoryService.findAllCells', () => {
  it('gives each owned cell its owner and colour, and unclaimed cells neither', async () => {
    const { prisma, service } = setup();
    prisma.territoryCell.findMany.mockResolvedValue([
      { id: 'c1', territoryId: 't1', row: 0, col: 0, ownerships: [{ userId: 'u1' }] },
      { id: 'c2', territoryId: 't1', row: 0, col: 1, ownerships: [] },
    ]);

    const cells = await service.findAllCells();

    // exact shapes: nothing about the owner except their id and colour reaches the map
    expect(cells).toEqual([
      { id: 'c1', territoryId: 't1', row: 0, col: 0, ownerId: 'u1', ownerColor: getColorForUser('u1') },
      { id: 'c2', territoryId: 't1', row: 0, col: 1, ownerId: null, ownerColor: UNCLAIMED_COLOR },
    ]);
    expect(prisma.territoryCell.findMany).toHaveBeenCalledWith(openOwnershipsQuery);
  });
});

describe('TerritoryService.findAll', () => {
  it('gives an owned territory its owner and colour, and an unclaimed one neither', async () => {
    const { prisma, service } = setup();
    prisma.territory.findMany.mockResolvedValue([
      { id: 't1', name: 'M Hostel', svgPathId: 'm-hostel', tier: 'SETTLEMENT', ownerships: [{ userId: 'u1' }] },
      { id: 't2', name: 'D Hostel', svgPathId: 'd-hostel', tier: 'STRONGHOLD', ownerships: [] },
    ]);

    const territories = await service.findAll();

    expect(territories).toEqual([
      { id: 't1', name: 'M Hostel', svgPathId: 'm-hostel', tier: 'SETTLEMENT', ownerId: 'u1', ownerColor: getColorForUser('u1') },
      { id: 't2', name: 'D Hostel', svgPathId: 'd-hostel', tier: 'STRONGHOLD', ownerId: null, ownerColor: UNCLAIMED_COLOR },
    ]);
    expect(prisma.territory.findMany).toHaveBeenCalledWith(openOwnershipsQuery);
  });
});
