// Single source of truth for how a territory tier looks, shared by the map,
// the dashboard, the contests lobby and the zone panel.

export type Tier = 'OUTPOST' | 'SETTLEMENT' | 'STRONGHOLD' | 'CITADEL';

export interface TierMeta {
  label: string;
  /** 0 = lowest tier. */
  rank: number;
  accent: string;
  /** 24x24 filled icon path. */
  icon: string;
  blurb: string;
}

export const TIER_META: Record<Tier, TierMeta> = {
  OUTPOST: {
    label: 'Outpost',
    rank: 0,
    accent: '#94a3b8',
    icon: 'M6 3h2v18H6zM9 4h11l-3 4.5L20 13H9z',
    blurb: 'A foothold. Cheap to take, easy to lose.',
  },
  SETTLEMENT: {
    label: 'Settlement',
    rank: 1,
    accent: '#34d399',
    icon: 'M2 12 12 3l10 9h-3v9h-5v-6h-4v6H5v-9z',
    blurb: 'A growing holding with real value.',
  },
  STRONGHOLD: {
    label: 'Stronghold',
    rank: 2,
    accent: '#fbbf24',
    icon: 'M12 2 20 5v7c0 5-3.4 8.4-8 10-4.6-1.6-8-5-8-10V5z',
    blurb: 'Fortified ground. Hard to crack.',
  },
  CITADEL: {
    label: 'Citadel',
    rank: 3,
    accent: '#e879f9',
    icon: 'M2 19 4 7l5 5 3-8 3 8 5-5 2 12z',
    blurb: 'A crown jewel of the campus.',
  },
};

export function tierOf(value: string | undefined | null): Tier {
  return value && value in TIER_META ? (value as Tier) : 'OUTPOST';
}
