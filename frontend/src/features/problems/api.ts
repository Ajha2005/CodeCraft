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

/** What "Run" reports for one of the problem's own examples. */
export interface RunCaseResult {
  index: number;
  input: unknown;
  expectedOutput: string;
  actualOutput: string;
  /** AC | WA | TLE | RE | CE */
  status: string;
  passed: boolean;
  runtimeMs: number;
  /** Compiler or runtime error text. */
  error?: string;
}

export interface RunResult {
  problemId: number;
  language: string;
  passed: number;
  total: number;
  /** AC when every example passed, otherwise the first failing example's status. */
  verdict: string;
  results: RunCaseResult[];
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

/** A failed request, with the HTTP status and the server's own message when it sent one. */
export class RunRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'RunRequestError';
    this.status = status;
  }
}

/** Runs the code on the problem's own examples. Nothing is saved, scored or captured, so a demo visitor may use it too. */
export async function runExamples(token: string | null, body: { problemId: number; language: string; code: string }): Promise<RunResult> {
  const res = await fetch(`${API_BASE}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `Request failed: ${res.status}`;
    try {
      const data = (await res.json()) as { message?: unknown };
      if (typeof data.message === 'string') message = data.message;
      else if (Array.isArray(data.message) && typeof data.message[0] === 'string') message = data.message[0];
    } catch {
      // not JSON: keep the generic text
    }
    throw new RunRequestError(res.status, message);
  }
  return (await res.json()) as RunResult;
}

export function fetchSubmission(token: string | null, id: string): Promise<SubmissionResult> {
  return getJson<SubmissionResult>(`${API_BASE}/submissions/${id}`, token);
}

export function fetchScore(token: string | null, submissionId: string): Promise<ScoreResult> {
  return getJson<ScoreResult>(`${API_BASE}/scoring/submission/${submissionId}`, token);
}
