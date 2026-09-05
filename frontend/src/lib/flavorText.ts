// Central copy bank for CodeCraft's "territory capture" flavor text.
// Everything here is optional dressing — every call site has a plain-English
// fallback, and the flavorTextEnabled setting (see auth/AuthContext) lets a
// user turn all of it off for a minimal-chrome interface.

function dayIndex(): number {
  const now = new Date();
  return Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86_400_000);
}

/** Deterministic pick that stays the same all day, rotates daily. */
export function pickDaily<T>(pool: readonly T[]): T {
  return pool[dayIndex() % pool.length];
}

/** Random pick, for moments that should feel varied within a single session. */
export function pickRandom<T>(pool: readonly T[]): T {
  return pool[Math.floor(Math.random() * pool.length)];
}

export const LOGIN_GREETINGS = [
  "Soldier's back. The map hasn't forgotten you.",
  'Territory report loaded. Command is standing by.',
  'Which front do you want to push today, Commander?',
  'The campaign continues. Sign in to resume.',
  'Reinforcements requested at the front. That means you.',
  "Uniform's still warm from yesterday's push.",
  'Command has a fresh briefing waiting on the other side.',
  'Every zone is quieter without its Commander.',
  'The war room lights are on. Someone left them on for you.',
  'Ready when you are, Commander.',
] as const;

export const PROBLEM_HOVER_UNSOLVED = [
  'Uncharted territory. First blood is worth extra.',
  'No flag planted here yet.',
  'Scouted, never taken.',
] as const;

export const PROBLEM_HOVER_REMATCH = [
  "You've been here before. Time for a rematch?",
  'Unfinished business at this front.',
  'The last attempt fell short. Try again?',
] as const;

export const DIFFICULTY_TAG: Record<string, string> = {
  Easy: 'Skirmish',
  Medium: 'Siege',
  Hard: 'Last Stand',
};

export const JUDGE_RUNNING = [
  'Deploying troops…',
  'Running reconnaissance…',
  'Judge is deliberating…',
  'Scouting the test cases…',
] as const;

export const VERDICT_AC = [
  'Territory captured!',
  'Flag planted. Zone secured.',
  'Front line pushed forward!',
] as const;

export const VERDICT_WA = [
  'Ambushed. Regroup and try again.',
  'Repelled — but the front is still yours to take.',
  'Not this time. Reassess and push again.',
] as const;

export const VERDICT_TLE = [
  'Too slow, soldier — the enemy outran you.',
  'Reinforcements arrived too late.',
  'The clock beat you to it this time.',
] as const;

export const VERDICT_OTHER = [
  'Mission report: not a clean win. Regroup.',
  'The judge found a weakness in the plan.',
] as const;

export function verdictFlavor(verdict: string): string {
  if (verdict === 'AC') return pickRandom(VERDICT_AC);
  if (verdict === 'WA') return pickRandom(VERDICT_WA);
  if (verdict === 'TLE') return pickRandom(VERDICT_TLE);
  return pickRandom(VERDICT_OTHER);
}

export function streakToast(count: number): string {
  return `You're on a warpath 🔥 (${count} in a row)`;
}

export const EMPTY_ZONE_TAP = 'This land answers to no one. Yet.';

export const EMPTY_PROBLEM_LIST = 'Uncharted. Every empire starts with one soldier and one problem.';

export const EMPTY_LEADERBOARD = 'No ruler yet. Could be you.';

export function rankUpToast(fromTitle: string, toTitle: string): string {
  return `Promoted: ${fromTitle} → ${toTitle}`;
}

export function nearMissNudge(points: number, name: string | null): string {
  const rounded = Math.ceil(points);
  return name
    ? `${rounded} points from overtaking ${name}. One good submission away.`
    : `${rounded} points from the rank above you. One good submission away.`;
}

// Rank titles by 1-indexed college leaderboard position.
const RANK_TITLES: readonly { max: number; title: string }[] = [
  { max: 1, title: 'Warlord' },
  { max: 3, title: 'General' },
  { max: 10, title: 'Commander' },
  { max: 25, title: 'Raider' },
  { max: Infinity, title: 'Recruit' },
];

export function rankTitle(rank: number | null): string {
  if (!rank) return 'Unranked';
  return RANK_TITLES.find((t) => rank <= t.max)!.title;
}

export function streakLabel(current: number): string {
  if (current <= 0) return 'No active streak';
  if (current === 1) return '1 day on the front';
  return `${current} days on the front`;
}

export const MISSED_DAY_NUDGE = "The front's been quiet without you. Jump back in?";
