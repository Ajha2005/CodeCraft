import type { MajorityZone } from '../api/client';
import type { AwardedCell } from '../features/problems/api';
import { computeAchievements, type Achievement, type AchievementInput } from './achievements';
import { streakStage, type StreakStage } from './streak';
import type { Tier } from './tiers';
import { tierOf } from './tiers';

// A "celebration" is a moment worth stopping for: an achievement unlocking, the
// first cell you ever hold, your first cell in a new tier, winning a zone, or
// the streak flame growing. They are worked out by comparing what the player had
// a moment ago with what they have now, so nothing new is stored on the server.

export type Celebration =
  | { id: string; kind: 'achievement'; achievement: Achievement }
  | { id: string; kind: 'first-cell'; tier: Tier; cell: AwardedCell | null }
  | { id: string; kind: 'tier-first'; tier: Tier; cell: AwardedCell | null }
  | { id: string; kind: 'majority'; zone: MajorityZone }
  | { id: string; kind: 'streak'; stage: StreakStage; days: number };

/** Everything the comparison looks at. */
export interface Snapshot {
  achievementInput: AchievementInput;
  cellsHeld: number;
  cellsByTier: Record<string, number>;
  majorityZones: MajorityZone[];
  streakDays: number;
}

export interface Seen {
  achievements: Set<string>;
  moments: Set<string>;
}

const TIERS: Tier[] = ['OUTPOST', 'SETTLEMENT', 'STRONGHOLD', 'CITADEL'];

/** Every achievement id and moment key the snapshot already satisfies: used to start quietly. */
export function currentKeys(snap: Snapshot): Seen {
  const achievements = new Set(
    computeAchievements(snap.achievementInput)
      .filter((a) => a.unlocked)
      .map((a) => a.id),
  );
  const moments = new Set<string>();
  if (snap.cellsHeld > 0) moments.add('cell:first');
  for (const t of TIERS) if ((snap.cellsByTier[t] ?? 0) > 0) moments.add(`tier:${t}`);
  for (const z of snap.majorityZones) moments.add(`majority:${z.territoryId}`);
  return { achievements, moments };
}

/**
 * What to celebrate going from `prev` to `next`. `seen` holds what has already
 * been celebrated for this player (on any device), so a cell lost and won back
 * does not throw the same party twice. Returns the events in the order to show
 * them, and the keys to remember.
 */
export function detectCelebrations(
  prev: Snapshot,
  next: Snapshot,
  seen: Seen,
  /** The cell the solve that triggered this refresh just earned, when known. */
  justWon: AwardedCell | null,
): { events: Celebration[]; remember: Seen } {
  const events: Celebration[] = [];
  const remember: Seen = { achievements: new Set(), moments: new Set() };

  // --- cells ---------------------------------------------------------------
  const firstCellNow = prev.cellsHeld === 0 && next.cellsHeld > 0 && !seen.moments.has('cell:first');
  if (firstCellNow) {
    const tier = tierOf(justWon?.tier ?? TIERS.find((t) => (next.cellsByTier[t] ?? 0) > 0));
    events.push({ id: 'cell:first', kind: 'first-cell', tier, cell: justWon });
    remember.moments.add('cell:first');
    remember.moments.add(`tier:${tier}`);
  }
  for (const tier of TIERS) {
    const key = `tier:${tier}`;
    const gained = (prev.cellsByTier[tier] ?? 0) === 0 && (next.cellsByTier[tier] ?? 0) > 0;
    if (!gained || seen.moments.has(key) || remember.moments.has(key)) continue;
    events.push({ id: key, kind: 'tier-first', tier, cell: justWon && tierOf(justWon.tier) === tier ? justWon : null });
    remember.moments.add(key);
  }
  const hadMajority = new Set(prev.majorityZones.map((z) => z.territoryId));
  for (const zone of next.majorityZones) {
    const key = `majority:${zone.territoryId}`;
    if (hadMajority.has(zone.territoryId) || seen.moments.has(key)) continue;
    events.push({ id: key, kind: 'majority', zone });
    remember.moments.add(key);
  }

  // --- the flame -----------------------------------------------------------
  const before = streakStage(prev.streakDays);
  const after = streakStage(next.streakDays);
  if (after.index > before.index && after.from > 0) {
    events.push({ id: `streak:${after.from}`, kind: 'streak', stage: after, days: next.streakDays });
  }

  // --- achievements --------------------------------------------------------
  for (const a of computeAchievements(next.achievementInput)) {
    if (!a.unlocked || seen.achievements.has(a.id)) continue;
    events.push({ id: `achievement:${a.id}`, kind: 'achievement', achievement: a });
    remember.achievements.add(a.id);
  }

  return { events, remember };
}
