// The streak flame grows as the streak does. Stages are a pure function of the
// number of days, so every place that shows the flame agrees on how big it is.

export interface StreakStage {
  /** 0 = ember ... 4 = legend. */
  index: number;
  name: string;
  /** Days the stage starts at. */
  from: number;
  /** Outer / inner / glow colours of the flame at this stage. */
  outer: [string, string];
  inner: [string, string];
  glow: string;
  blurb: string;
}

export const STREAK_STAGES: readonly StreakStage[] = [
  { index: 0, name: 'Ember', from: 0, outer: ['#f97316', '#b45309'], inner: ['#fde68a', '#fb923c'], glow: '#f97316', blurb: 'A small flame. Keep it fed.' },
  { index: 1, name: 'Blaze', from: 3, outer: ['#fb923c', '#dc2626'], inner: ['#fef08a', '#f97316'], glow: '#fb923c', blurb: 'Three days in. It is catching.' },
  { index: 2, name: 'Inferno', from: 7, outer: ['#f87171', '#be123c'], inner: ['#fff7ad', '#fb923c'], glow: '#f43f5e', blurb: 'A full week. Hard to ignore.' },
  { index: 3, name: 'Blue flame', from: 14, outer: ['#38bdf8', '#4f46e5'], inner: ['#e0f2fe', '#67e8f9'], glow: '#38bdf8', blurb: 'Two weeks. It burns hotter than it should.' },
  { index: 4, name: 'Legend', from: 30, outer: ['#fde047', '#e879f9'], inner: ['#ffffff', '#fef3c7'], glow: '#fde047', blurb: 'Thirty days. The campus talks about this flame.' },
];

/** The stage a streak of `days` has reached. */
export function streakStage(days: number): StreakStage {
  let stage = STREAK_STAGES[0];
  for (const s of STREAK_STAGES) if (days >= s.from) stage = s;
  return stage;
}

/** The stage after the current one, or null at the top. */
export function nextStreakStage(days: number): StreakStage | null {
  return STREAK_STAGES.find((s) => s.from > days) ?? null;
}

/** From this hour of the local day on, an unsolved day starts to feel urgent. */
export const LATE_HOUR = 18;

/**
 * The streak is "at risk" when it is still alive only thanks to yesterday: the
 * player has not solved anything today. `late` says it is evening already, which
 * is when the flame starts to flicker.
 */
export function streakRisk(current: number, solvedToday: number, now: Date = new Date()): { atRisk: boolean; late: boolean } {
  const atRisk = current > 0 && solvedToday === 0;
  return { atRisk, late: atRisk && now.getHours() >= LATE_HOUR };
}
