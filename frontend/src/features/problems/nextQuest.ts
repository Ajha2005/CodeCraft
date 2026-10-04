import type { ProblemStatus, ProblemSummary } from './api';
import { difficultyRank } from './difficulty';

export interface NextUp {
  problem: ProblemSummary;
  /** "retry" resumes something you already tried; "start" is a fresh problem. */
  kind: 'retry' | 'start';
  /** True when the player has not cleared anything yet. */
  first: boolean;
}

/**
 * What to suggest on the quest board: pick up a problem you attempted, else the
 * next one you have not cleared. A brand-new player gets the gentlest problem.
 */
export function pickNextUp(problems: ProblemSummary[], status: Record<number, ProblemStatus>): NextUp | null {
  const open = problems.filter((p) => status[p.id] !== 'AC');
  if (open.length === 0) return null;

  const retry = open.find((p) => status[p.id] === 'ATTEMPTED');
  if (retry) return { problem: retry, kind: 'retry', first: false };

  const cleared = problems.length - open.length;
  if (cleared === 0) {
    const gentlest = [...open].sort((a, b) => difficultyRank(a.difficultyLevel) - difficultyRank(b.difficultyLevel) || a.id - b.id)[0];
    return { problem: gentlest, kind: 'start', first: true };
  }
  return { problem: open[0], kind: 'start', first: false };
}

/** The next problem after `currentId` (wrapping) that is not cleared yet. */
export function pickNextAfter(problems: ProblemSummary[], status: Record<number, ProblemStatus>, currentId: number): ProblemSummary | null {
  if (problems.length === 0) return null;
  const at = problems.findIndex((p) => p.id === currentId);
  for (let step = 1; step <= problems.length; step++) {
    const p = problems[(at + step + problems.length) % problems.length];
    if (p.id !== currentId && status[p.id] !== 'AC') return p;
  }
  return null;
}
