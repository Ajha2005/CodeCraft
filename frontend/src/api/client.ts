import axios from 'axios';

export const api = axios.create({
  baseURL: 'http://localhost:3000',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export interface PerformanceScore {
  id: string;
  submissionId: string;
  difficultyWeight: number;
  correctness: number;
  attemptsPenalty: number;
  timeEfficiency: number;
  totalScore: number;
  createdAt: string;
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
export interface CampaignSummary {
  territoriesHeld: number;
  cellsGainedToday: number;
  cellsLostToday: number;
}
export const fetchCampaignSummary = async (userId: string) => {
  const res = await api.get<CampaignSummary>(`/scoring/campaign-summary/${userId}`);
  return res.data;
};