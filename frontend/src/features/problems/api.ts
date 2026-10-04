// Thin wrappers around the problems / submissions endpoints, so the page
// components deal in typed values rather than raw fetch calls.

export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000';

export interface ProblemSummary {
  id: number;
  title: string;
  difficultyLevel: string;
}

export interface ProblemExample {
  input: unknown;
  output: unknown;
}

export interface ProblemDetail extends ProblemSummary {
  description: string;
  examples: ProblemExample[];
  constraints: string[];
  testCases: { input: unknown; expected_output: unknown }[];
  boilerplate: Record<string, string>;
}

export interface SubmissionResult {
  id: string;
  verdict: string;
  totalPassed: number;
  totalTests: number;
  pointsAwarded?: boolean;
  noPointsReason?: string | null;
}

export interface ScoreResult {
  difficultyWeight: number;
  correctness: number;
  attemptsPenalty: number;
  timeEfficiency: number;
  totalScore: number;
}

export type ProblemStatus = 'AC' | 'ATTEMPTED';

/** The backend caps a page at 100; the whole catalogue is small, so we read it all. */
const PAGE_SIZE = 100;

async function getJson<T>(url: string, token?: string | null): Promise<T> {
  const res = await fetch(url, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return (await res.json()) as T;
}

export async function fetchAllProblems(): Promise<ProblemSummary[]> {
  const all: ProblemSummary[] = [];
  let total = Infinity;
  while (all.length < total) {
    const page = await getJson<{ items: ProblemSummary[]; total: number }>(`${API_BASE}/problems?limit=${PAGE_SIZE}&offset=${all.length}`);
    all.push(...page.items);
    total = page.total;
    if (page.items.length === 0) break;
  }
  return all;
}

export function fetchProblem(id: number): Promise<ProblemDetail> {
  return getJson<ProblemDetail>(`${API_BASE}/problems/${id}`);
}

export async function fetchStatuses(userId: string, token: string | null): Promise<Record<number, ProblemStatus>> {
  const res = await fetch(`${API_BASE}/submissions/status/${userId}`, { headers: { Authorization: `Bearer ${token}` } });
  return res.ok ? ((await res.json()) as Record<number, ProblemStatus>) : {};
}

export async function postSubmission(token: string | null, body: { userId: string; problemId: number; language: string; code: string }): Promise<SubmissionResult> {
  const res = await fetch(`${API_BASE}/submissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return (await res.json()) as SubmissionResult;
}

export function fetchSubmission(token: string | null, id: string): Promise<SubmissionResult> {
  return getJson<SubmissionResult>(`${API_BASE}/submissions/${id}`, token);
}

export function fetchScore(token: string | null, submissionId: string): Promise<ScoreResult> {
  return getJson<ScoreResult>(`${API_BASE}/scoring/submission/${submissionId}`, token);
}
