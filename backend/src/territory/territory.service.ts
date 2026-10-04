import { Injectable } from '@nestjs/common';
import { AuthUser } from '../auth/auth-user';
import { getColorForUser } from '../common/color/color.util';
import { PrismaService } from '../prisma/prisma.service';

export interface ZoneDto {
  id: string;
  name: string;
  svgPathId: string;
  tier: string;
}

/**
 * The static shape of the map: which cells exist and where. Identical for every
 * viewer and unchanged until the map is regridded, so clients may cache it.
 * `cells[i]` is `[cellId, zoneIndex, row, col]`; `zones[zoneIndex]` is the zone's
 * SVG id. The position of a cell in this array is its index in OwnersDto.held.
 */
export interface GridDto {
  gridVersion: number;
  zones: string[];
  cells: [id: string, zone: number, row: number, col: number][];
}

/**
 * Who holds what right now, for one viewer. Owners are listed once and cells
 * point at them, so the payload stays tiny however many cells are held.
 * `isMe` is decided here for the viewer; no user ids are sent.
 */
export interface OwnersDto {
  gridVersion: number;
  owners: { username: string; color: string; isMe: boolean }[];
  held: [cellIndex: number, ownerIndex: number][];
}

interface GridCache {
  at: number;
  grid: GridDto;
  indexById: Map<string, number>;
}

const GRID_CACHE_MS = 60_000;

@Injectable()
export class TerritoryService {
  private gridCache: GridCache | null = null;
  private zoneSlugs: Map<string, string> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<ZoneDto[]> {
    const territories = await this.prisma.territory.findMany({
      select: { id: true, name: true, svgPathId: true, tier: true },
      orderBy: { svgPathId: 'asc' },
    });
    return territories;
  }

  /** SVG id of a zone from its database id. The 46 zones never change, so they are read once. */
  async zoneSlug(territoryId: string): Promise<string | null> {
    if (!this.zoneSlugs) {
      const rows = await this.prisma.territory.findMany({ select: { id: true, svgPathId: true } });
      this.zoneSlugs = new Map(rows.map((r) => [r.id, r.svgPathId]));
    }
    return this.zoneSlugs.get(territoryId) ?? null;
  }

  async grid(): Promise<GridDto> {
    return (await this.loadGrid()).grid;
  }

  async owners(viewer: AuthUser): Promise<OwnersDto> {
    const { grid, indexById } = await this.loadGrid();
    const open = await this.prisma.territoryCellOwnership.findMany({
      where: { closedAt: null, cell: { retiredAt: null } },
      select: { cellId: true, userId: true, user: { select: { username: true } } },
    });

    const ownerIndex = new Map<string, number>();
    const owners: OwnersDto['owners'] = [];
    const held: OwnersDto['held'] = [];
    for (const row of open) {
      const cellIndex = indexById.get(row.cellId);
      if (cellIndex === undefined) continue;
      let index = ownerIndex.get(row.userId);
      if (index === undefined) {
        index = owners.length;
        ownerIndex.set(row.userId, index);
        owners.push({
          username: row.user.username,
          color: getColorForUser(row.userId),
          isMe: !viewer.isGuest && viewer.userId === row.userId,
        });
      }
      held.push([cellIndex, index]);
    }
    return { gridVersion: grid.gridVersion, owners, held };
  }

  private async loadGrid(): Promise<GridCache> {
    if (this.gridCache && Date.now() - this.gridCache.at < GRID_CACHE_MS) return this.gridCache;

    const cells = await this.prisma.territoryCell.findMany({
      where: { retiredAt: null },
      select: { id: true, row: true, col: true, gridVersion: true, territory: { select: { svgPathId: true } } },
      orderBy: [{ territory: { svgPathId: 'asc' } }, { row: 'asc' }, { col: 'asc' }, { id: 'asc' }],
    });

    const zones: string[] = [];
    const zoneIndex = new Map<string, number>();
    const indexById = new Map<string, number>();
    const tuples: GridDto['cells'] = [];
    let gridVersion = 1;
    for (const cell of cells) {
      const slug = cell.territory.svgPathId;
      let zone = zoneIndex.get(slug);
      if (zone === undefined) {
        zone = zones.length;
        zoneIndex.set(slug, zone);
        zones.push(slug);
      }
      indexById.set(cell.id, tuples.length);
      tuples.push([cell.id, zone, cell.row, cell.col]);
      if (cell.gridVersion > gridVersion) gridVersion = cell.gridVersion;
    }
    this.gridCache = { at: Date.now(), grid: { gridVersion, zones, cells: tuples }, indexById };
    return this.gridCache;
  }
}
