// Thin wrappers around the problems / submissions endpoints, so the page
// components deal in typed values rather than raw fetch calls.
import { request } from '../../lib/http';

export interface ProblemSummary {
  id: number;
  title: string;
  difficultyLevel: string;
}

export interface ProblemExample {
  input: unknown;
  output: unknown;
}

/** A problem as the server publishes it: the statement, the worked examples and starter code. The graded (hidden) test cases never leave the server. */
export interface ProblemDetail extends ProblemSummary {
  description: string;
  examples: ProblemExample[];
  constraints: string[];
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

export type ProblemStatus = 'AC' | 'ATTEMPTED';

/** The backend caps a page at 100; the whole catalogue is small, so we read it all. */
const PAGE_SIZE = 100;

export async function fetchAllProblems(): Promise<ProblemSummary[]> {
  const all: ProblemSummary[] = [];
  let total = Infinity;
  while (all.length < total) {
    const page = await request<{ items: ProblemSummary[]; total: number }>(`/problems?limit=${PAGE_SIZE}&offset=${all.length}`);
    all.push(...page.items);
    total = page.total;
    if (page.items.length === 0) break;
  }
  return all;
}

export function fetchProblem(id: number): Promise<ProblemDetail> {
  return request<ProblemDetail>(`/problems/${id}`);
}

/** The signed-in player's best verdict per problem. */
export function fetchStatuses(): Promise<Record<number, ProblemStatus>> {
  return request<Record<number, ProblemStatus>>('/submissions/me/status').catch(() => ({}));
}

/** Who is submitting comes from the access token; the body never names a user. */
export function postSubmission(body: { problemId: number; language: string; code: string }): Promise<SubmissionResult> {
  return request<SubmissionResult>('/submissions', { method: 'POST', body });
}

/** Runs the code on the problem's own examples. Nothing is saved, scored or captured. */
export function runExamples(body: { problemId: number; language: string; code: string }): Promise<RunResult> {
  return request<RunResult>('/run', { method: 'POST', body });
}

export function fetchSubmission(id: string): Promise<SubmissionResult> {
  return request<SubmissionResult>(`/submissions/${id}`);
}

export function fetchScore(submissionId: string): Promise<ScoreResult> {
  return request<ScoreResult>(`/scoring/submission/${submissionId}`);
}
