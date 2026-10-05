import type { GridResponse, OwnersResponse, TerritoryCellDto } from '../../../lib/api';
import { UNCLAIMED_COLOR } from '../../../lib/playerColor';
import type { TerritoryDto } from '../../../types/territory';

/**
 * Joins the two things the server sends about the map into the cells the map
 * draws: the grid (which cells exist; the same for everybody, so the browser can
 * cache it) and the owners (who holds what, from the caller's point of view).
 *
 * Players are told apart by username only: the server does not send user ids to
 * other players. A cell's `ownerId` is that username (an opaque key, the same for
 * every cell one player holds), and whether a cell is the viewer's own is the
 * server's `isMe`, never worked out here.
 */
export function buildCells(zones: TerritoryDto[], grid: GridResponse, owners: OwnersResponse): TerritoryCellDto[] {
  const territoryBySlug = new Map(zones.map((z) => [z.svgPathId, z.id]));
  const zoneTerritory = grid.zones.map((slug) => territoryBySlug.get(slug) ?? null);

  const ownerOfCell = new Map<number, OwnersResponse['owners'][number]>();
  for (const [cellIndex, ownerIndex] of owners.held) {
    const owner = owners.owners[ownerIndex];
    if (owner) ownerOfCell.set(cellIndex, owner);
  }

  const cells: TerritoryCellDto[] = [];
  grid.cells.forEach(([id, zoneIndex, row, col], index) => {
    const territoryId = zoneTerritory[zoneIndex];
    if (!territoryId) return; // a zone the server knows but the zone list does not: nothing to draw it in
    const owner = ownerOfCell.get(index);
    cells.push({
      id,
      territoryId,
      row,
      col,
      ownerId: owner ? owner.username : null,
      ownerUsername: owner ? owner.username : null,
      ownerColor: owner ? owner.color : UNCLAIMED_COLOR,
      isMe: !!owner && owner.isMe,
    });
  });
  return cells;
}

/** The `cell:updated` socket event: one cell changed hands. Personalised by the server, so `isMe` is already right for this viewer. */
export interface CellUpdate {
  cellId: string;
  zone: string;
  row: number;
  col: number;
  ownerUsername: string | null;
  ownerColor: string;
  isMe: boolean;
}

/** The cells with one update applied, or null when the update names a cell we do not have (the grid changed: reload). */
export function applyCellUpdate(cells: TerritoryCellDto[], update: CellUpdate): TerritoryCellDto[] | null {
  const index = cells.findIndex((c) => c.id === update.cellId);
  if (index === -1) return null;
  const next = cells.slice();
  next[index] = {
    ...cells[index],
    ownerId: update.ownerUsername,
    ownerUsername: update.ownerUsername,
    ownerColor: update.ownerUsername ? update.ownerColor : UNCLAIMED_COLOR,
    isMe: !!update.ownerUsername && update.isMe,
  };
  return next;
}
