import { createContext, useContext } from 'react';
import type { DailyProgress } from '../api/client';
import type { StreakInfo } from './api';
import type { LevelInfo } from './progression';

export interface PlayerStats {
  loaded: boolean;
  totalScore: number;
  level: LevelInfo;
  rank: number | null;
  streak: StreakInfo | null;
  daily: DailyProgress | null;
  /** Number of scored solves. */
  solves: number;
  /** Highest single-problem difficulty weight solved (10 / 25 / 50). */
  hardestWeight: number;
}

export interface LevelUpEvent {
  from: number;
  to: number;
}

export interface PlayerStatsContextValue {
  stats: PlayerStats;
  refresh: () => Promise<void>;
  levelUp: LevelUpEvent | null;
  dismissLevelUp: () => void;
}

export const PlayerStatsContext = createContext<PlayerStatsContextValue | undefined>(undefined);

export function usePlayerStats(): PlayerStatsContextValue {
  const ctx = useContext(PlayerStatsContext);
  if (!ctx) throw new Error('usePlayerStats must be used within PlayerStatsProvider');
  return ctx;
}
