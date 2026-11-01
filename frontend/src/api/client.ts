import axios from 'axios';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || 'http://localhost:3000',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/** The cell a correct solve won; null on solves from before cells were recorded, or when none was left to take. */
export interface SolveCell {
  id: string;
  territoryId: string;
  territoryName: string;
  tier: string;
  row: number;
  col: number;
  /** Taken from a rival rather than claimed free. */
  captured: boolean;
  /** Still the player's; false once a rival or a duel has taken it since. */
  held: boolean;
}

export interface PerformanceScore {
  id: string;
  submissionId: string;
  difficultyWeight: number;
  correctness: number;
  attemptsPenalty: number;
  timeEfficiency: number;
  totalScore: number;
  createdAt: string;
  problem: { id: number; title: string; difficultyLevel: string };
  cell: SolveCell | null;
}
export interface ScoreResponse {
  totalScore: number;
  scores: PerformanceScore[];
}
export interface Territory {
  id: string;
  territoryId: string;
  userId: string;
  sourceType: string;
  assignedAt: string;
  closedAt: string | null;
  territory: {
    id: string;
    name: string;
    tier: string;
    baseValue: number;
  };
}
export interface DailyProgress {
  qualifyingCount: number;
  cap: number;
}
export const fetchUserScores = async (userId: string) => {
  const res = await api.get<ScoreResponse>(`/scoring/user/${userId}`);
  return res.data;
};
export const fetchUserTerritories = async (userId: string) => {
  const res = await api.get<Territory[]>(`/scoring/territories/${userId}`);
  return res.data;
};
export const fetchDailyProgress = async (userId: string) => {
  const res = await api.get<DailyProgress>(`/scoring/daily-progress/${userId}`);
  return res.data;
};
export interface RankInfo {
  userId: string;
  rank: number | null;
}
export const fetchUserRank = async (userId: string) => {
  const res = await api.get<RankInfo>(`/leaderboard/rank/${userId}`);
  return res.data;
};
export interface NearMiss {
  rank: number | null;
  pointsToNext: number;
  nextRankName: string | null;
}
export const fetchNearMiss = async (userId: string) => {
  const res = await api.get<NearMiss>(`/leaderboard/near-miss/${userId}`);
  return res.data;
};
export interface MajorityZone {
  territoryId: string;
  name: string;
  tier: string;
  held: number;
  total: number;
}

export interface CampaignSummary {
  territoriesHeld: number;
  cellsHeld: number;
  /** Cells held per tier (OUTPOST / SETTLEMENT / STRONGHOLD / CITADEL). */
  cellsByTier: Record<string, number>;
  /** Zones where the player holds more than half the cells. */
  majorityZones: MajorityZone[];
  cellsGainedToday: number;
  cellsLostToday: number;
}
export const fetchCampaignSummary = async (userId: string) => {
  const res = await api.get<CampaignSummary>(`/scoring/campaign-summary/${userId}`);
  return res.data;
};