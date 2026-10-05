import { describe, expect, it } from 'vitest';
import type { GridResponse, OwnersResponse } from '../../../lib/api';
import { UNCLAIMED_COLOR } from '../../../lib/playerColor';
import type { TerritoryDto } from '../../../types/territory';
import { applyCellUpdate, buildCells } from './buildCells';

const zones: TerritoryDto[] = [
  { id: 'territory-library', name: 'Library', svgPathId: 'library', tier: 'OUTPOST' },
  { id: 'territory-lt', name: 'LT', svgPathId: 'lt', tier: 'CITADEL' },
];

const grid: GridResponse = {
  gridVersion: 2,
  zones: ['library', 'lt', 'removed-zone'],
  cells: [
    ['cell-a', 0, 0, 0],
    ['cell-b', 0, 0, 1],
    ['cell-c', 1, 0, 0],
    ['cell-d', 1, 1, 0],
    ['cell-x', 2, 0, 0], // a zone the zone list does not have
  ],
};

const owners: OwnersResponse = {
  gridVersion: 2,
  owners: [
    { username: 'alice', color: '#ef4444', isMe: true },
    { username: 'bob', color: '#3b82f6', isMe: false },
  ],
  held: [
    [0, 0],
    [2, 1],
    [3, 0],
  ],
};

describe('buildCells', () => {
  const cells = buildCells(zones, grid, owners);
  const byId = Object.fromEntries(cells.map((c) => [c.id, c]));

  it('makes one cell per grid cell that belongs to a known zone', () => {
    expect(cells.map((c) => c.id)).toEqual(['cell-a', 'cell-b', 'cell-c', 'cell-d']);
  });

  it('puts each cell in its zone and at its row and column', () => {
    expect(byId['cell-a']).toMatchObject({ territoryId: 'territory-library', row: 0, col: 0 });
    expect(byId['cell-b']).toMatchObject({ territoryId: 'territory-library', row: 0, col: 1 });
    expect(byId['cell-d']).toMatchObject({ territoryId: 'territory-lt', row: 1, col: 0 });
  });

  it('names the holder by username, with the server\'s color and its own verdict on who is "me"', () => {
    expect(byId['cell-a']).toMatchObject({ ownerId: 'alice', ownerUsername: 'alice', ownerColor: '#ef4444', isMe: true });
    expect(byId['cell-c']).toMatchObject({ ownerId: 'bob', ownerUsername: 'bob', ownerColor: '#3b82f6', isMe: false });
    expect(byId['cell-d']).toMatchObject({ ownerId: 'alice', isMe: true });
  });

  it('leaves unclaimed cells unowned', () => {
    expect(byId['cell-b']).toMatchObject({ ownerId: null, ownerUsername: null, ownerColor: UNCLAIMED_COLOR, isMe: false });
  });

  it('keeps one key for all of a player\'s cells, so patches and zone shares add up', () => {
    expect(byId['cell-a'].ownerId).toBe(byId['cell-d'].ownerId);
  });

  it('never claims a cell is mine for a demo guest, whose owners all say isMe: false', () => {
    const asGuest = buildCells(zones, grid, { ...owners, owners: owners.owners.map((o) => ({ ...o, isMe: false })) });
    expect(asGuest.some((c) => c.isMe)).toBe(false);
  });

  it('carries no user id of any kind', () => {
    expect(Object.keys(cells[0]).sort()).toEqual(['col', 'id', 'isMe', 'ownerColor', 'ownerId', 'ownerUsername', 'row', 'territoryId']);
  });
});

describe('applyCellUpdate', () => {
  const cells = buildCells(zones, grid, owners);

  it('moves a cell to its new holder, using the server\'s isMe for this viewer', () => {
    const next = applyCellUpdate(cells, { cellId: 'cell-b', zone: 'library', row: 0, col: 1, ownerUsername: 'bob', ownerColor: '#3b82f6', isMe: false });
    expect(next?.find((c) => c.id === 'cell-b')).toMatchObject({ ownerId: 'bob', ownerUsername: 'bob', isMe: false });

    const mine = applyCellUpdate(cells, { cellId: 'cell-c', zone: 'lt', row: 0, col: 0, ownerUsername: 'alice', ownerColor: '#ef4444', isMe: true });
    expect(mine?.find((c) => c.id === 'cell-c')).toMatchObject({ ownerId: 'alice', isMe: true });
  });

  it('does not change the cells it was given', () => {
    const before = JSON.stringify(cells);
    applyCellUpdate(cells, { cellId: 'cell-b', zone: 'library', row: 0, col: 1, ownerUsername: 'bob', ownerColor: '#3b82f6', isMe: false });
    expect(JSON.stringify(cells)).toBe(before);
  });

  it('can clear a cell', () => {
    const next = applyCellUpdate(cells, { cellId: 'cell-a', zone: 'library', row: 0, col: 0, ownerUsername: null, ownerColor: '#000000', isMe: true });
    expect(next?.find((c) => c.id === 'cell-a')).toMatchObject({ ownerId: null, ownerUsername: null, ownerColor: UNCLAIMED_COLOR, isMe: false });
  });

  it('answers null for a cell it has never heard of, which means the grid changed and the map must reload', () => {
    expect(applyCellUpdate(cells, { cellId: 'new-cell', zone: 'library', row: 9, col: 9, ownerUsername: 'bob', ownerColor: '#000', isMe: false })).toBeNull();
  });
});
