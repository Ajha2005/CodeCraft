import axios from 'axios';
import { expireSession, readToken } from '../auth/session';
import { API_BASE } from '../lib/http';

export const api = axios.create({
  baseURL: API_BASE,
});

api.interceptors.request.use((config) => {
  const token = readToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// An expired or revoked session answers 401: sign out instead of leaving a half-working page.
api.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) expireSession();
    return Promise.reject(error);
  },
);

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
// Everything below is about the signed-in player: the server reads who that is from the
// access token, so there is no user id in any of these paths.
export const fetchUserScores = async () => {
  const res = await api.get<ScoreResponse>('/scoring/me');
  return res.data;
};
export const fetchUserTerritories = async () => {
  const res = await api.get<Territory[]>('/scoring/me/territories');
  return res.data;
};
export const fetchDailyProgress = async () => {
  const res = await api.get<DailyProgress>('/scoring/me/daily-progress');
  return res.data;
};
export interface RankInfo {
  rank: number | null;
}
export const fetchUserRank = async () => {
  const res = await api.get<RankInfo>('/leaderboard/me/rank');
  return res.data;
};
export interface NearMiss {
  rank: number | null;
  pointsToNext: number;
  nextRankName: string | null;
}
export const fetchNearMiss = async () => {
  const res = await api.get<NearMiss>('/leaderboard/me/near-miss');
  return res.data;
};
export interface CampaignSummary {
  territoriesHeld: number;
  cellsGainedToday: number;
  cellsLostToday: number;
}
export const fetchCampaignSummary = async () => {
  const res = await api.get<CampaignSummary>('/scoring/me/campaign-summary');
  return res.data;
};
