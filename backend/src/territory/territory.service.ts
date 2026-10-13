import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getColorForUser, UNCLAIMED_COLOR } from '../common/color/color.util';

export interface TerritoryDto {
  id: string;
  name: string;
  svgPathId: string;
  ownerColor: string;
  ownerId: string | null;
  tier: string;
}

export interface TerritoryCellDto {
  id: string;
  territoryId: string;
  row: number;
  col: number;
  ownerId: string | null;
  ownerColor: string;
}

@Injectable()
export class TerritoryService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<TerritoryDto[]> {
    const territories = await this.prisma.territory.findMany({
      include: {
        ownerships: {
          where: { closedAt: null },
        },
      },
    });

    return territories.map((t) => {
      const currentOwnership = t.ownerships[0];
      const ownerId = currentOwnership?.userId ?? null;

      return {
        id: t.id,
        name: t.name,
        svgPathId: t.svgPathId,
        ownerColor: ownerId ? getColorForUser(ownerId) : UNCLAIMED_COLOR,
        ownerId,
        tier: t.tier,
      };
    });
  }

  async findAllCells(): Promise<TerritoryCellDto[]> {
    const cells = await this.prisma.territoryCell.findMany({
      include: {
        ownerships: {
          where: { closedAt: null },
        },
      },
    });

    return cells.map((c) => {
      const current = c.ownerships[0];
      const ownerId = current?.userId ?? null;

      return {
        id: c.id,
        territoryId: c.territoryId,
        row: c.row,
        col: c.col,
        ownerId,
        ownerColor: ownerId ? getColorForUser(ownerId) : UNCLAIMED_COLOR,
      };
    });
  }
}