import type { TerritoryDto } from '../../../types/territory';
import type { TerritoryCellDto } from '../../../lib/api';
import { aggregateOwnership, type OwnerShare } from '../utils/computeStripeWidths';
import { tierOf, type Tier } from '../../../lib/tiers';

export type ZoneStatus = 'yours' | 'rival' | 'contested' | 'unclaimed';

export interface ZoneSummary {
  /** svg path id - the key the engine uses. */
  id: string;
  territoryId: string | null;
  name: string;
  tier: Tier;
  total: number;
  owned: number;
  /** 0..1 of cells captured by anyone. */
  fraction: number;
  /** Owners, biggest first. */
  shares: OwnerShare[];
  mine: number;
  status: ZoneStatus;
  topColor: string | null;
}

export function summarizeZone(
  svgPathId: string,
  territory: TerritoryDto | undefined,
  cells: TerritoryCellDto[],
  userId: string | null,
): ZoneSummary {
  const shares = aggregateOwnership(cells).sort((a, b) => b.cellCount - a.cellCount);
  const owned = shares.reduce((s, x) => s + x.cellCount, 0);
  const mine = userId ? (shares.find((s) => s.userId === userId)?.cellCount ?? 0) : 0;

  let status: ZoneStatus = 'unclaimed';
  if (shares.length > 1) status = 'contested';
  else if (shares.length === 1) status = shares[0].userId === userId ? 'yours' : 'rival';

  return {
    id: svgPathId,
    territoryId: territory?.id ?? null,
    name: territory?.name ?? svgPathId,
    tier: tierOf(territory?.tier),
    total: cells.length,
    owned,
    fraction: cells.length ? owned / cells.length : 0,
    shares,
    mine,
    status,
    topColor: shares[0]?.color ?? null,
  };
}

export const STATUS_LABEL: Record<ZoneStatus, string> = {
  yours: 'Held by you',
  rival: 'Rival-held',
  contested: 'Contested',
  unclaimed: 'Unclaimed',
};

export const STATUS_COLOR: Record<ZoneStatus, string> = {
  yours: '#34d399',
  rival: '#fb7185',
  contested: '#f97316',
  unclaimed: '#94a3b8',
};
