import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/useAuth';
import { fetchCampaignSummary, fetchDailyProgress, fetchUserRank, fetchUserScores, fetchUserTerritories } from '../api/client';
import { fetchStreak } from './api';
import { fetchStatuses } from '../features/problems/api';
import { clearedCounts } from '../features/sheet/sheetData';
import { readDailyTotal } from './daily';
import { achievementInputFrom, readExploredCount } from './achievements';
import { currentKeys, detectCelebrations, type Celebration, type Seen, type Snapshot } from './celebrations';
import { demoStatuses, getDemoState } from './demoStore';
import { levelFromScore } from './progression';
import { PlayerStatsContext, type LevelUpEvent, type PlayerStats } from './playerStatsContext';
import { tierOf } from './tiers';

const EMPTY: PlayerStats = {
  loaded: false,
  totalScore: 0,
  level: levelFromScore(0),
  rank: null,
  streak: null,
  daily: null,
  solves: 0,
  hardestWeight: 0,
  territories: [],
  campaign: null,
  explored: 0,
  sheet: { frontsDone: 0, realmsDone: 0, sheetSolved: 0 },
  dailies: 0,
};

/** More than this at once is a wall of pop-ups, not a celebration. */
const MAX_QUEUED = 6;

const levelKey = (userId: string) => `cc.level.v1:${userId}`;
const achievementsKey = (userId: string) => `cc.achievements.v1:${userId}`;
const momentsKey = (userId: string) => `cc.moments.v1:${userId}`;

function readList(key: string): string[] | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return null;
  }
}

function writeList(key: string, values: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify([...values]));
  } catch {
    // best-effort convenience only
  }
}

function readStoredLevel(userId: string): number | null {
  try {
    const raw = localStorage.getItem(levelKey(userId));
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function storeLevel(userId: string, level: number) {
  try {
    localStorage.setItem(levelKey(userId), String(level));
  } catch {
    // best-effort convenience only
  }
}

function snapshotOf(stats: PlayerStats): Snapshot {
  const cellsByTier = stats.campaign?.cellsByTier ?? {};
  return {
    achievementInput: achievementInputFrom({
      solves: stats.solves,
      hardestWeight: stats.hardestWeight,
      longestStreak: stats.streak?.longest ?? 0,
      territoriesHeld: stats.territories.length,
      hasCitadel: (cellsByTier.CITADEL ?? 0) > 0 || stats.territories.some((t) => tierOf(t.territory.tier) === 'CITADEL'),
      rank: stats.rank,
      daily: stats.daily,
      explored: stats.explored,
      frontsCleared: stats.sheet.frontsDone,
      realmsCleared: stats.sheet.realmsDone,
      dailiesCleared: stats.dailies,
    }),
    cellsHeld: stats.campaign?.cellsHeld ?? 0,
    cellsByTier,
    majorityZones: stats.campaign?.majorityZones ?? [],
    streakDays: stats.streak?.current ?? 0,
  };
}

/** A demo player's numbers, worked out from what is saved on this device. */
function demoStats(): PlayerStats {
  const { solves } = getDemoState();
  const totalScore = solves.reduce((sum, s) => sum + s.totalScore, 0);
  return {
    ...EMPTY,
    loaded: true,
    totalScore,
    level: levelFromScore(totalScore),
    solves: solves.length,
    hardestWeight: Math.max(0, ...solves.map((s) => s.difficultyWeight)),
    sheet: sheetFromStatuses(demoStatuses(getDemoState())),
    dailies: readDailyTotal('demo'),
  };
}

/** Warpath progress from a problem-status map. */
function sheetFromStatuses(status: Record<number, string>) {
  const cleared = new Set(
    Object.entries(status)
      .filter(([, s]) => s === 'AC')
      .map(([id]) => Number(id)),
  );
  return clearedCounts(cleared);
}

/**
 * One shared copy of "how is this player doing" - score, level, rank, streak,
 * daily progress, cells - so the nav, the map HUD and the pages never disagree
 * and never each re-fetch the same endpoints. Pages call `refresh()` after
 * something that changes the numbers (an accepted solve, a finished duel).
 *
 * It is also where "something worth celebrating just happened" is noticed: each
 * refresh is compared with the one before it (see lib/celebrations).
 */
export function PlayerStatsProvider({ children }: { children: ReactNode }) {
  const { user, token, isDemo } = useAuth();
  const userId = user?.userId ?? null;
  const [stats, setStats] = useState<PlayerStats>(EMPTY);
  const [levelUp, setLevelUp] = useState<LevelUpEvent | null>(null);
  const [queue, setQueue] = useState<Celebration[]>([]);
  // The last complete snapshot, to compare the next one against.
  const last = useRef<{ userId: string; snap: Snapshot } | null>(null);

  const celebrate = useCallback((uid: string, next: Snapshot, justWon: Parameters<typeof detectCelebrations>[3], demo: boolean) => {
    const storedAchievements = readList(achievementsKey(uid));
    const storedMoments = readList(momentsKey(uid));
    const seen: Seen = { achievements: new Set(storedAchievements ?? []), moments: new Set(storedMoments ?? []) };
    const prev = last.current?.userId === uid ? last.current.snap : null;

    if (!prev) {
      // First look at this player in this session: start from what they already
      // have, so nobody is greeted with every old achievement at once.
      const now = currentKeys(next);
      writeList(achievementsKey(uid), new Set([...seen.achievements, ...now.achievements]));
      writeList(momentsKey(uid), new Set([...seen.moments, ...now.moments]));
    } else {
      const { events, remember } = detectCelebrations(prev, next, seen, justWon, { colorReveal: !demo });
      if (remember.achievements.size > 0) writeList(achievementsKey(uid), new Set([...seen.achievements, ...remember.achievements]));
      if (remember.moments.size > 0) writeList(momentsKey(uid), new Set([...seen.moments, ...remember.moments]));
      if (events.length > 0) {
        setQueue((q) => {
          const known = new Set(q.map((c) => c.id));
          return [...q, ...events.filter((e) => !known.has(e.id))].slice(0, MAX_QUEUED);
        });
      }
    }
    last.current = { userId: uid, snap: next };
  }, []);

  const refresh = useCallback(
    async (options?: { cell?: Parameters<typeof detectCelebrations>[3] }) => {
      if (!userId) return;
      const justWon = options?.cell ?? null;

      if (isDemo) {
        const next = demoStats();
        setStats(next);
        celebrate(userId, snapshotOf(next), justWon, true);
        return;
      }

      const [scores, rank, streak, daily, territories, campaign, statuses] = await Promise.allSettled([
        fetchUserScores(userId),
        fetchUserRank(userId),
        fetchStreak(userId),
        fetchDailyProgress(userId),
        fetchUserTerritories(userId),
        fetchCampaignSummary(userId),
        fetchStatuses(userId, token),
      ]);

      const scoreData = scores.status === 'fulfilled' ? scores.value : null;
      const totalScore = scoreData?.totalScore ?? 0;
      const level = levelFromScore(totalScore);

      const next: PlayerStats = {
        loaded: true,
        totalScore,
        level,
        rank: rank.status === 'fulfilled' ? rank.value.rank : null,
        streak: streak.status === 'fulfilled' ? streak.value : null,
        daily: daily.status === 'fulfilled' ? daily.value : null,
        solves: scoreData?.scores.length ?? 0,
        hardestWeight: scoreData ? Math.max(0, ...scoreData.scores.map((s) => s.difficultyWeight)) : 0,
        territories: territories.status === 'fulfilled' ? territories.value : [],
        campaign: campaign.status === 'fulfilled' ? campaign.value : null,
        explored: readExploredCount(userId),
        sheet: statuses.status === 'fulfilled' ? sheetFromStatuses(statuses.value) : EMPTY.sheet,
        dailies: readDailyTotal(userId),
      };
      setStats(next);

      if (scoreData) {
        const previous = readStoredLevel(userId);
        if (previous !== null && level.level > previous) setLevelUp({ from: previous, to: level.level });
        storeLevel(userId, level.level);
      }

      // Only compare complete pictures: a request that failed would look like
      // something was lost (or, worse, gained back and celebrated twice).
      const complete = [scores, rank, streak, daily, territories, campaign].every((r) => r.status === 'fulfilled');
      if (complete) celebrate(userId, snapshotOf(next), justWon, false);
    },
    [userId, token, isDemo, celebrate],
  );

  useEffect(() => {
    // Deferred (same approach as ChallengesPage) so the effect body itself
    // never sets state synchronously; the fetch is the real source of truth.
    const timer = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  const dismissLevelUp = useCallback(() => setLevelUp(null), []);
  const dismissCelebration = useCallback(() => setQueue((q) => q.slice(1)), []);

  const value = useMemo(
    () => ({
      stats,
      refresh,
      levelUp,
      dismissLevelUp,
      celebration: queue[0] ?? null,
      celebrationsWaiting: Math.max(0, queue.length - 1),
      dismissCelebration,
    }),
    [stats, refresh, levelUp, dismissLevelUp, queue, dismissCelebration],
  );

  return <PlayerStatsContext.Provider value={value}>{children}</PlayerStatsContext.Provider>;
}
