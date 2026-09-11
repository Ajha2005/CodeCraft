import { api } from '../../api/client';
import type { ContestDetail, ContestSummary } from './types';

export async function createChallenge(
  cellId: string,
  opts?: { problemId?: number; durationSeconds?: number },
): Promise<ContestDetail> {
  const res = await api.post<ContestDetail>('/contests/challenges', { cellId, ...opts });
  return res.data;
}

export async function listIncomingChallenges(): Promise<ContestSummary[]> {
  const res = await api.get<ContestSummary[]>('/contests/incoming');
  return res.data;
}

export async function listOutgoingChallenges(): Promise<ContestSummary[]> {
  const res = await api.get<ContestSummary[]>('/contests/outgoing');
  return res.data;
}

export async function listActiveContests(): Promise<ContestSummary[]> {
  const res = await api.get<ContestSummary[]>('/contests/active');
  return res.data;
}

export async function getContest(id: string): Promise<ContestDetail> {
  const res = await api.get<ContestDetail>(`/contests/${id}`);
  return res.data;
}

export async function acceptChallenge(id: string): Promise<ContestDetail> {
  const res = await api.post<ContestDetail>(`/contests/${id}/accept`);
  return res.data;
}

export async function declineChallenge(id: string): Promise<{ id: string; status: string }> {
  const res = await api.post<{ id: string; status: string }>(`/contests/${id}/decline`);
  return res.data;
}

export interface ContestSubmissionResult {
  id: string;
  verdict: string;
  totalPassed: number;
  totalTests: number;
}

export async function submitContestSolution(
  id: string,
  code: string,
  language: string,
): Promise<ContestSubmissionResult> {
  const res = await api.post<ContestSubmissionResult>(`/contests/${id}/submissions`, { code, language });
  return res.data;
}
