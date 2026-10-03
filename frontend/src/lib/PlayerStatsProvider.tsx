import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';
import { fetchDailyProgress, fetchUserRank, fetchUserScores } from '../api/client';
import { fetchStreak } from './api';
import { levelFromScore } from './progression';
import { PlayerStatsContext, type LevelUpEvent, type PlayerStats } from './playerStatsContext';

const EMPTY: PlayerStats = {
  loaded: false,
  totalScore: 0,
  level: levelFromScore(0),
  rank: null,
  streak: null,
  daily: null,
  solves: 0,
  hardestWeight: 0,
};

const levelKey = (userId: string) => `cc.level.v1:${userId}`;

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

/**
 * One shared copy of "how is this player doing" - score, level, rank, streak,
 * daily progress - so the nav, the map HUD and the pages never disagree and
 * never each re-fetch the same endpoints. Pages call `refresh()` after
 * something that changes the numbers (an accepted solve, a finished duel).
 */
export function PlayerStatsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.userId ?? null;
  const [stats, setStats] = useState<PlayerStats>(EMPTY);
  const [levelUp, setLevelUp] = useState<LevelUpEvent | null>(null);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const [scores, rank, streak, daily] = await Promise.allSettled([
      fetchUserScores(userId),
      fetchUserRank(userId),
      fetchStreak(userId),
      fetchDailyProgress(userId),
    ]);

    const scoreData = scores.status === 'fulfilled' ? scores.value : null;
    const totalScore = scoreData?.totalScore ?? 0;
    const level = levelFromScore(totalScore);

    setStats({
      loaded: true,
      totalScore,
      level,
      rank: rank.status === 'fulfilled' ? rank.value.rank : null,
      streak: streak.status === 'fulfilled' ? streak.value : null,
      daily: daily.status === 'fulfilled' ? daily.value : null,
      solves: scoreData?.scores.length ?? 0,
      hardestWeight: scoreData ? Math.max(0, ...scoreData.scores.map((s) => s.difficultyWeight)) : 0,
    });

    if (scoreData) {
      const previous = readStoredLevel(userId);
      if (previous !== null && level.level > previous) setLevelUp({ from: previous, to: level.level });
      storeLevel(userId, level.level);
    }
  }, [userId]);

  useEffect(() => {
    // Deferred (same approach as ChallengesPage) so the effect body itself
    // never sets state synchronously; the fetch is the real source of truth.
    const timer = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  const dismissLevelUp = useCallback(() => setLevelUp(null), []);

  const value = useMemo(() => ({ stats, refresh, levelUp, dismissLevelUp }), [stats, refresh, levelUp, dismissLevelUp]);

  return <PlayerStatsContext.Provider value={value}>{children}</PlayerStatsContext.Provider>;
}
