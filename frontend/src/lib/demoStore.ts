import { useSyncExternalStore } from 'react';

// Demo mode keeps a player's progress on this device only: no account, no
// server record, no territory. This is that record - which problems they tried,
// which they solved, and the score each solve earned.

const KEY = 'cc.demo.progress.v1';

export interface DemoSolve {
  problemId: number;
  title: string;
  difficultyLevel: string;
  difficultyWeight: number;
  attemptsPenalty: number;
  timeEfficiency: number;
  totalScore: number;
  createdAt: string;
}

export interface DemoState {
  /** Tries made per problem, which drives the retry penalty exactly as it does for real players. */
  attempts: Record<number, number>;
  solves: DemoSolve[];
}

const EMPTY: DemoState = { attempts: {}, solves: [] };

let cachedRaw: string | null | undefined;
let cachedState: DemoState = EMPTY;
const listeners = new Set<() => void>();

function readRaw(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function parse(raw: string | null): DemoState {
  if (!raw) return EMPTY;
  try {
    const data = JSON.parse(raw) as Partial<DemoState>;
    return {
      attempts: data.attempts && typeof data.attempts === 'object' ? data.attempts : {},
      solves: Array.isArray(data.solves) ? data.solves : [],
    };
  } catch {
    return EMPTY;
  }
}

/** The current state. The same object is returned until something changes, so it is safe as a store snapshot. */
export function getDemoState(): DemoState {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedState = parse(raw);
  }
  return cachedState;
}

function write(next: DemoState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage is blocked: keep the progress for this page load at least.
    cachedRaw = undefined;
    cachedState = next;
  }
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) fn();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener('storage', onStorage);
  };
}

export function useDemoState(): DemoState {
  return useSyncExternalStore(subscribe, getDemoState, () => EMPTY);
}

/** Count a try on `problemId` and return which try it is (1 for the first). */
export function startDemoAttempt(problemId: number): number {
  const state = getDemoState();
  const n = (state.attempts[problemId] ?? 0) + 1;
  write({ ...state, attempts: { ...state.attempts, [problemId]: n } });
  return n;
}

/** Save a solve. A problem only ever scores once, as for real players; returns whether this one counted. */
export function recordDemoSolve(solve: DemoSolve): boolean {
  const state = getDemoState();
  if (state.solves.some((s) => s.problemId === solve.problemId)) return false;
  write({ ...state, solves: [solve, ...state.solves] });
  return true;
}

export function demoStatuses(state: DemoState): Record<number, 'AC' | 'ATTEMPTED'> {
  const status: Record<number, 'AC' | 'ATTEMPTED'> = {};
  for (const id of Object.keys(state.attempts)) status[Number(id)] = 'ATTEMPTED';
  for (const s of state.solves) status[s.problemId] = 'AC';
  return status;
}

export function clearDemoProgress() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to clear
  }
  cachedRaw = undefined;
  cachedState = EMPTY;
  listeners.forEach((fn) => fn());
}
