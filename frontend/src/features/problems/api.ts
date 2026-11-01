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

/** The cell a correct solve won (see backend ScoringController). */
export interface AwardedCell {
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

export interface ScoreResult {
  difficultyWeight: number;
  correctness: number;
  attemptsPenalty: number;
  timeEfficiency: number;
  totalScore: number;
  /** Null for a solve that earned no cell (and for every demo solve). */
  cell?: AwardedCell | null;
}

/** A demo submission's progress: the verdict, plus the score once it is accepted. */
export interface DemoSubmissionResult extends SubmissionResult {
  score: ScoreResult | null;
}

export type ProblemStatus = 'AC' | 'ATTEMPTED';

/** The backend caps a page at 100; the whole catalogue is small, so we read it all. */
const PAGE_SIZE = 100;

/** The server's own explanation when it gave one (rate limit, busy judge), else the status code. */
async function errorMessage(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { message?: string | string[] };
    const message = Array.isArray(data.message) ? data.message[0] : data.message;
    if (message) return message;
  } catch {
    // not JSON
  }
  return `Request failed: ${res.status}`;
}

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

export async function postSubmission(token: string | null, body: { problemId: number; language: string; code: string }): Promise<SubmissionResult> {
  const res = await fetch(`${API_BASE}/submissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as SubmissionResult;
}

export async function postDemoSubmission(body: { problemId: number; language: string; code: string; attempts: number }): Promise<DemoSubmissionResult> {
  const res = await fetch(`${API_BASE}/demo/submissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as DemoSubmissionResult;
}

export function fetchDemoSubmission(id: string): Promise<DemoSubmissionResult> {
  return getJson<DemoSubmissionResult>(`${API_BASE}/demo/submissions/${encodeURIComponent(id)}`);
}

export function fetchSubmission(token: string | null, id: string): Promise<SubmissionResult> {
  return getJson<SubmissionResult>(`${API_BASE}/submissions/${id}`, token);
}

export function fetchScore(token: string | null, submissionId: string): Promise<ScoreResult> {
  return getJson<ScoreResult>(`${API_BASE}/scoring/submission/${submissionId}`, token);
}
