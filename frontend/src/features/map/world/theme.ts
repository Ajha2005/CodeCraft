// Visual vocabulary for the campus world: tiers, zone kinds, palette.
//
// Tier accents deliberately match the colors the rest of the app already
// uses for tier badges (slate / emerald / amber / fuchsia) so a "CITADEL" is
// the same color on the map, the dashboard and the contests lobby.

import { TIER_META, tierOf, type Tier } from '../../../lib/tiers';

export { tierOf, type Tier };

export interface TierStyle {
  label: string;
  /** Ordering, 0 = lowest. */
  rank: number;
  /** How tall the zone's block stands above the ground, in world units. */
  height: number;
  accent: string;
  /** 24x24 icon path (fill), drawn next to the zone name. */
  icon: string;
  blurb: string;
}

const TIER_HEIGHT: Record<Tier, number> = { OUTPOST: 7, SETTLEMENT: 13, STRONGHOLD: 20, CITADEL: 30 };

export const TIER_STYLE: Record<Tier, TierStyle> = {
  OUTPOST: { ...TIER_META.OUTPOST, height: TIER_HEIGHT.OUTPOST },
  SETTLEMENT: { ...TIER_META.SETTLEMENT, height: TIER_HEIGHT.SETTLEMENT },
  STRONGHOLD: { ...TIER_META.STRONGHOLD, height: TIER_HEIGHT.STRONGHOLD },
  CITADEL: { ...TIER_META.CITADEL, height: TIER_HEIGHT.CITADEL },
};

/**
 * What a zone *is*, drawn from its svg id. Purely cosmetic: it picks the
 * terrain/props painted on the roof so the world reads as a campus rather
 * than 46 identical boxes. Unknown ids fall back to a generic building.
 */
export type ZoneKind =
  | 'hostel'
  | 'academic'
  | 'residence'
  | 'market'
  | 'plaza'
  | 'field'
  | 'track'
  | 'court'
  | 'parking'
  | 'gate'
  | 'forest'
  | 'water'
  | 'medical'
  | 'construction'
  | 'auditorium'
  | 'building';

const KIND_BY_ID: Record<string, ZoneKind> = {
  'cricket-ground': 'field',
  'synth-track': 'track',
  'sports-complex': 'court',
  'fete-area': 'plaza',
  'cos-market': 'market',
  nirvana: 'market',
  'gods-plan': 'market',
  parking: 'parking',
  'main-gate': 'gate',
  'forest-area': 'forest',
  waterbody: 'water',
  'health-centre': 'medical',
  'treatment-area': 'medical',
  'coming-soon': 'construction',
  'main-audi': 'auditorium',
  lt: 'auditorium',
  'guest-house': 'residence',
  'faculty-residence': 'residence',
  'staff-quarter-1': 'residence',
  'staff-quarter-2': 'residence',
  library: 'academic',
  csed: 'academic',
  mech: 'academic',
  'bcd-block': 'academic',
  'ef-block': 'academic',
  'tan-g-block': 'academic',
  'elc-building': 'academic',
  tslas: 'academic',
  'venture-lab': 'academic',
  polytech: 'academic',
  lp: 'academic',
};

export function kindOf(svgPathId: string): ZoneKind {
  if (KIND_BY_ID[svgPathId]) return KIND_BY_ID[svgPathId];
  if (svgPathId.endsWith('-hostel')) return 'hostel';
  return 'building';
}

/** Kinds that sit *in* the ground (no tall walls): fields, water, forest... */
export const FLAT_KINDS: ReadonlySet<ZoneKind> = new Set<ZoneKind>(['field', 'track', 'court', 'parking', 'forest', 'water', 'plaza', 'gate']);

export const PALETTE = {
  void: '#03060b',
  voidGlow: '#07121f',
  ground: '#0b1522',
  groundLight: '#10202f',
  grid: '#1b3a50',
  asphalt: '#0a121c',
  sidewalk: '#14212e',
  curb: '#1f3547',
  stone: '#2b3441',
  stoneLight: '#3a4656',
  cyan: '#22d3ee',
  teal: '#2dd4bf',
  gold: '#fbbf24',
  danger: '#f97316',
  you: '#22d3ee',
  water: '#0e4a63',
  waterLight: '#1ea5c4',
  grass: '#12402f',
  grassLight: '#1a5a41',
  forest: '#0e3a28',
  text: '#e8f1f8',
  textDim: '#9fb4c6',
  ink: '#04080d',
} as const;

export const FONT_DISPLAY = '"Rajdhani", "Segoe UI", system-ui, sans-serif';
export const FONT_MONO = 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';
