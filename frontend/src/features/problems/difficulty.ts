import type { IconName } from '../../components/ui/Icon';

export interface DifficultyMeta {
  text: string;
  border: string;
  bg: string;
  accent: string;
  icon: IconName;
  /** Base XP: the scoring DifficultyWeight x 10. */
  xp: number;
}

export const DIFFICULTIES = ['Easy', 'Medium', 'Hard'] as const;

const DIFFICULTY: Record<string, DifficultyMeta> = {
  Easy: { text: 'text-emerald-400', border: 'border-emerald-500/40', bg: 'bg-emerald-500/10', accent: '#34d399', icon: 'shield', xp: 100 },
  Medium: { text: 'text-amber-400', border: 'border-amber-500/40', bg: 'bg-amber-500/10', accent: '#fbbf24', icon: 'swords', xp: 250 },
  Hard: { text: 'text-rose-400', border: 'border-rose-500/40', bg: 'bg-rose-500/10', accent: '#fb7185', icon: 'skull', xp: 500 },
};

const FALLBACK: DifficultyMeta = {
  text: 'text-slate-400',
  border: 'border-slate-600/40',
  bg: 'bg-slate-500/10',
  accent: '#94a3b8',
  icon: 'flag',
  xp: 0,
};

export function difficultyMeta(level: string): DifficultyMeta {
  return DIFFICULTY[level] ?? FALLBACK;
}

/** Rank used to suggest the gentlest unsolved problem first. */
export function difficultyRank(level: string): number {
  const i = (DIFFICULTIES as readonly string[]).indexOf(level);
  return i === -1 ? DIFFICULTIES.length : i;
}

export const padId = (id: number) => `#${String(id).padStart(3, '0')}`;
