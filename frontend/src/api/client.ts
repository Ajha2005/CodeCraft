import axios from 'axios';

export const api = axios.create({
  baseURL: 'http://localhost:3000',
});

export const TEST_USER_ID = '7cca2cb9-3acc-4606-9b13-0c639c94a330';

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
