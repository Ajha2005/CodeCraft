import { useSyncExternalStore } from 'react';
import type { ProblemSummary } from '../features/problems/api';
import { CORE_IDS } from '../features/sheet/sheetData';

// The Daily Quest: one problem a day, the same for everyone, picked from the
// Warpath's core quests (so it is always real DSA). It is never required: it
// does not gate anything, costs nothing to ignore, and no score or territory
// depends on it. All that is remembered is which days you cleared it, on this
// device, to show a gentle "dailies in a row" count.

const KEY = 'cc.daily.v1';
const EVENT = 'cc:daily';

/** Today as YYYY-MM-DD in the player's local time. */
export function todayKey(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function shift(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return todayKey(new Date(y, m - 1, d + days));
}

function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * The day's problem. Sorted by id first so the pick depends only on the date
 * and the catalogue, never on load order. Falls back to the whole catalogue
 * when none of the sheet's quests are available.
 */
export function dailyProblem(problems: ProblemSummary[], day = todayKey()): ProblemSummary | null {
  if (problems.length === 0) return null;
  const core = new Set(CORE_IDS);
  const pool = problems.filter((p) => core.has(p.id));
  const list = (pool.length > 0 ? pool : problems).slice().sort((a, b) => a.id - b.id);
  return list[hash(`codecraft-daily:${day}`) % list.length];
}

/** A random not-yet-cleared problem, for someone who finished the daily and wants more. */
export function bonusProblem(problems: ProblemSummary[], cleared: (id: number) => boolean, exclude?: number): ProblemSummary | null {
  const core = new Set(CORE_IDS);
  const open = problems.filter((p) => core.has(p.id) && !cleared(p.id) && p.id !== exclude);
  if (open.length === 0) return null;
  return open[Math.floor(Math.random() * open.length)];
}

// ---------------------------------------------------------------- history

type History = string[];

function read(userId: string): History {
  try {
    const raw = localStorage.getItem(`${KEY}:${userId}`);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Remember that today's daily was cleared. Safe to call for any problem: only the daily counts. */
export function markDailyCleared(userId: string, problemId: number, problems: ProblemSummary[]) {
  const today = todayKey();
  if (dailyProblem(problems, today)?.id !== problemId) return;
  const history = read(userId);
  if (history.includes(today)) return;
  try {
    localStorage.setItem(`${KEY}:${userId}`, JSON.stringify([...history, today].slice(-400)));
  } catch {
    // a convenience only
  }
  window.dispatchEvent(new Event(EVENT));
}

/** How many dailies a player has cleared in all (for the Daily Driver achievement). */
export function readDailyTotal(userId: string): number {
  return new Set(read(userId)).size;
}

export interface DailyState {
  /** Cleared today's daily on this device. */
  doneToday: boolean;
  /** Days in a row the daily was cleared, counting back from today (or yesterday, if today is still open). */
  streak: number;
  /** Total dailies cleared. */
  total: number;
}

function stateOf(history: History): DailyState {
  const days = new Set(history);
  const today = todayKey();
  const doneToday = days.has(today);
  let cursor = doneToday ? today : shift(today, -1);
  let streak = 0;
  while (days.has(cursor)) {
    streak++;
    cursor = shift(cursor, -1);
  }
  return { doneToday, streak, total: days.size };
}

const cache = new Map<string, { raw: string; state: DailyState }>();

function snapshot(userId: string): DailyState {
  let raw = '';
  try {
    raw = localStorage.getItem(`${KEY}:${userId}`) ?? '';
  } catch {
    // ignore
  }
  const key = `${userId}:${todayKey()}`;
  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.state;
  const state = stateOf(read(userId));
  cache.set(key, { raw, state });
  return state;
}

function subscribe(fn: () => void) {
  window.addEventListener(EVENT, fn);
  window.addEventListener('storage', fn);
  return () => {
    window.removeEventListener(EVENT, fn);
    window.removeEventListener('storage', fn);
  };
}

/** Daily-quest history for a player, live: re-renders when a daily is cleared. */
export function useDailyState(userId: string | null | undefined): DailyState {
  const id = userId ?? 'anon';
  return useSyncExternalStore(
    subscribe,
    () => snapshot(id),
    () => ({ doneToday: false, streak: 0, total: 0 }),
  );
}
