import { getColorForUser } from '../common/color/color.util';
import { TerritoryService } from './territory.service';

const cells = [
  { id: 'c-a0', row: 0, col: 0, gridVersion: 2, territory: { svgPathId: 'a-hostel' } },
  { id: 'c-a1', row: 0, col: 1, gridVersion: 2, territory: { svgPathId: 'a-hostel' } },
  { id: 'c-l0', row: 0, col: 0, gridVersion: 2, territory: { svgPathId: 'library' } },
];

function setup() {
  const prisma = {
    territory: { findMany: jest.fn() },
    territoryCell: { findMany: jest.fn().mockResolvedValue(cells) },
    territoryCellOwnership: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return { prisma, service: new TerritoryService(prisma as never) };
}

const viewer = (userId: string) => ({ userId, role: 'USER' as const, isGuest: false });
const guest = { userId: 'guest:1', role: 'GUEST' as const, isGuest: true };

describe('TerritoryService.findAll (zones)', () => {
  it('lists only id, name, svg id and tier: no owner fields at all', async () => {
    const { prisma, service } = setup();
    prisma.territory.findMany.mockResolvedValue([{ id: 't1', name: 'Library', svgPathId: 'library', tier: 'OUTPOST' }]);
    await expect(service.findAll()).resolves.toEqual([{ id: 't1', name: 'Library', svgPathId: 'library', tier: 'OUTPOST' }]);
    expect(prisma.territory.findMany).toHaveBeenCalledWith(expect.objectContaining({ select: { id: true, name: true, svgPathId: true, tier: true } }));
  });
});

describe('TerritoryService.grid', () => {
  it('describes the live cells as compact tuples grouped under zone ids', async () => {
    const { service } = setup();
    await expect(service.grid()).resolves.toEqual({
      gridVersion: 2,
      zones: ['a-hostel', 'library'],
      cells: [
        ['c-a0', 0, 0, 0],
        ['c-a1', 0, 0, 1],
        ['c-l0', 1, 0, 0],
      ],
    });
  });

  it('only asks for cells that have not been retired by a regrid, in a fixed order', async () => {
    const { prisma, service } = setup();
    await service.grid();
    expect(prisma.territoryCell.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { retiredAt: null },
        orderBy: [{ territory: { svgPathId: 'asc' } }, { row: 'asc' }, { col: 'asc' }, { id: 'asc' }],
      }),
    );
  });

  it('reads the database once per minute, not once per request', async () => {
    const { prisma, service } = setup();
    await service.grid();
    await service.grid();
    expect(prisma.territoryCell.findMany).toHaveBeenCalledTimes(1);
  });

  it('contains nothing about owners', async () => {
    const { service } = setup();
    expect(JSON.stringify(await service.grid())).not.toMatch(/owner|user|name/i);
  });
});

describe('TerritoryService.owners', () => {
  const open = [
    { cellId: 'c-a0', userId: 'u1', user: { username: 'arjun_m' } },
    { cellId: 'c-l0', userId: 'u2', user: { username: 'riya_k' } },
    { cellId: 'c-a1', userId: 'u1', user: { username: 'arjun_m' } },
    { cellId: 'c-retired', userId: 'u2', user: { username: 'riya_k' } }, // not in the live grid
  ];

  it('lists each owner once and points cells at them by grid position', async () => {
    const { prisma, service } = setup();
    prisma.territoryCellOwnership.findMany.mockResolvedValue(open);

    const result = await service.owners(viewer('u1'));

    expect(result.gridVersion).toBe(2);
    expect(result.owners).toEqual([
      { username: 'arjun_m', color: getColorForUser('u1'), isMe: true },
      { username: 'riya_k', color: getColorForUser('u2'), isMe: false },
    ]);
    expect(result.held).toEqual([
      [0, 0],
      [2, 1],
      [1, 0],
    ]);
  });

  it('marks nothing as mine for a demo session or another viewer', async () => {
    const { prisma, service } = setup();
    prisma.territoryCellOwnership.findMany.mockResolvedValue(open);
    expect((await service.owners(guest)).owners.every((o) => !o.isMe)).toBe(true);
    expect((await service.owners(viewer('u9'))).owners.every((o) => !o.isMe)).toBe(true);
  });

  it('sends usernames and colours only: no user ids, emails or names', async () => {
    const { prisma, service } = setup();
    prisma.territoryCellOwnership.findMany.mockResolvedValue(open);
    const text = JSON.stringify(await service.owners(viewer('u1')));
    expect(text).not.toMatch(/u1|u2|userId|email|passwordHash/);
    expect(prisma.territoryCellOwnership.findMany).toHaveBeenCalledWith({
      where: { closedAt: null, cell: { retiredAt: null } },
      select: { cellId: true, userId: true, user: { select: { username: true } } },
    });
  });
});

describe('TerritoryService.zoneSlug', () => {
  it('maps a zone id to its svg id and reads the 46 zones only once', async () => {
    const { prisma, service } = setup();
    prisma.territory.findMany.mockResolvedValue([{ id: 't1', svgPathId: 'library' }]);
    await expect(service.zoneSlug('t1')).resolves.toBe('library');
    await expect(service.zoneSlug('nope')).resolves.toBeNull();
    expect(prisma.territory.findMany).toHaveBeenCalledTimes(1);
  });
});
