import { createContext, useContext } from 'react';
import type { CampaignSummary, DailyProgress, Territory } from '../api/client';
import type { AwardedCell } from '../features/problems/api';
import type { Celebration } from './celebrations';
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
  /** Zones the player holds at least one cell in. */
  territories: Territory[];
  /** Cell counts per tier and zone majorities; null in demo mode (demo players hold no cells). */
  campaign: CampaignSummary | null;
  /** Distinct zones walked into on the map. */
  explored: number;
}

export interface LevelUpEvent {
  from: number;
  to: number;
}

export interface RefreshOptions {
  /** The cell the solve that triggered this refresh just won, so its celebration can show it. */
  cell?: AwardedCell | null;
}

export interface PlayerStatsContextValue {
  stats: PlayerStats;
  refresh: (options?: RefreshOptions) => Promise<void>;
  levelUp: LevelUpEvent | null;
  dismissLevelUp: () => void;
  /** The celebration on screen now, if any; the rest wait their turn. */
  celebration: Celebration | null;
  /** How many more are queued behind it. */
  celebrationsWaiting: number;
  dismissCelebration: () => void;
}

export const PlayerStatsContext = createContext<PlayerStatsContextValue | undefined>(undefined);

export function usePlayerStats(): PlayerStatsContextValue {
  const ctx = useContext(PlayerStatsContext);
  if (!ctx) throw new Error('usePlayerStats must be used within PlayerStatsProvider');
  return ctx;
}
