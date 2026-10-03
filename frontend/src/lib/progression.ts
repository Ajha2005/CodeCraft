// Level / XP is a purely cosmetic layer derived from the Performance Score the
// backend already computes - no new server state. Level n starts at
// STEP * (n-1)^2 points, so early levels come quickly and each later level asks
// a little more. With ~10 points per Easy solve that is a level every few solves
// at first and a long, meaningful climb after ~100 problems.

const STEP = 5;
const XP_PER_POINT = 10;

export interface LevelInfo {
  level: number;
  /** Total XP (score x 10), for display. */
  xp: number;
  /** XP earned inside the current level. */
  xpIntoLevel: number;
  /** XP the current level spans. */
  xpSpan: number;
  /** 0..1 progress to the next level. */
  pct: number;
  xpToNext: number;
}

export function levelFromScore(score: number): LevelInfo {
  const s = Math.max(0, Number.isFinite(score) ? score : 0);
  const level = Math.floor(Math.sqrt(s / STEP)) + 1;
  const base = STEP * (level - 1) * (level - 1);
  const next = STEP * level * level;
  const span = next - base;
  const into = s - base;
  return {
    level,
    xp: Math.round(s * XP_PER_POINT),
    xpIntoLevel: Math.round(into * XP_PER_POINT),
    xpSpan: Math.round(span * XP_PER_POINT),
    pct: span > 0 ? Math.min(1, into / span) : 0,
    xpToNext: Math.max(0, Math.ceil((next - s) * XP_PER_POINT)),
  };
}

export function formatXp(n: number): string {
  return n.toLocaleString('en-US');
}

/** A short flavour title for a level band, shown beside the badge. */
export function levelTitle(level: number): string {
  if (level >= 24) return 'Warlord';
  if (level >= 18) return 'General';
  if (level >= 12) return 'Commander';
  if (level >= 7) return 'Captain';
  if (level >= 4) return 'Raider';
  if (level >= 2) return 'Scout';
  return 'Recruit';
}
