import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { bonusProblem, dailyProblem, todayKey, useDailyState } from '../lib/daily';
import { useNow } from '../lib/useNow';
import { sfx } from '../lib/sfx';
import { DifficultyBadge } from '../features/problems/DifficultyBadge';
import { difficultyMeta, padId } from '../features/problems/difficulty';
import type { ProblemCatalog } from '../features/problems/useProblemCatalog';
import { FROM_BOARD, problemLink } from '../lib/links';
import { Icon } from './ui/Icon';

function untilMidnight(now: Date): string {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const mins = Math.max(0, Math.round((next.getTime() - now.getTime()) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * Today's Daily Quest: one problem a day, the same for everyone, picked from the
 * Warpath. Entirely optional - it blocks nothing and the quest board works the
 * same without it. Clearing it earns the problem's normal score, nothing extra.
 */
export function DailyQuestCard({ catalog, className = '' }: { catalog: ProblemCatalog; className?: string }) {
  const { user, flavorTextEnabled } = useAuth();
  const { problems, status, loading } = catalog;
  const now = useNow();
  const daily = useDailyState(user?.userId);
  const [bonusPick, setBonusPick] = useState<number | null>(null);

  const today = todayKey(now);
  const problem = useMemo(() => dailyProblem(problems, today), [problems, today]);
  if (loading || !problem) return null;

  const cleared = status[problem.id] === 'AC';
  const meta = difficultyMeta(problem.difficultyLevel);
  const bonus = bonusPick !== null ? (problems.find((p) => p.id === bonusPick) ?? null) : null;

  function rollBonus() {
    sfx.play('click');
    const pick = bonusProblem(problems, (id) => status[id] === 'AC', problem?.id);
    setBonusPick(pick?.id ?? null);
  }

  return (
    <section className={`hud-panel hud-panel-quiet relative overflow-hidden p-4 sm:p-5 animate-fade-in-up ${className}`} aria-label="Daily quest">
      <div className="pointer-events-none absolute -left-10 -top-12 h-40 w-40 rounded-full bg-amber-400/10 blur-3xl" />
      <div className="relative flex flex-wrap items-center gap-x-5 gap-y-3">
        <div className="relative h-12 w-12 shrink-0" style={{ filter: 'drop-shadow(0 0 10px rgba(251,191,36,0.45))' }}>
          <div className="hex absolute inset-0 bg-gradient-to-b from-amber-200 via-amber-400 to-amber-600" />
          <div className="hex absolute inset-[2px] flex items-center justify-center bg-gradient-to-b from-[#1d293d] to-[#020618]">
            <Icon name={cleared ? 'check' : 'gift'} className={`h-5 w-5 ${cleared ? 'text-emerald-300' : 'text-amber-300'}`} />
          </div>
        </div>

        <div className="min-w-0 flex-1 basis-56">
          <p className="hud-label flex flex-wrap items-center gap-x-2 !text-amber-300">
            {flavorTextEnabled ? 'Daily quest' : 'Problem of the day'}
            <span className="font-sans text-[0.72rem] font-medium normal-case tracking-normal text-slate-500">
              · optional · new one in {untilMidnight(now)}
            </span>
          </p>
          <p className="mt-0.5 truncate text-base font-semibold text-slate-50 sm:text-lg" title={problem.title}>
            <span className="mr-2 font-mono text-xs font-bold text-slate-500">{padId(problem.id)}</span>
            {problem.title}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <DifficultyBadge level={problem.difficultyLevel} />
            <span className="font-mono text-[0.7rem] font-bold text-slate-400">+{meta.xp} XP</span>
            {daily.streak > 0 && (
              <span className="flex items-center gap-1 rounded-md border border-orange-400/40 bg-orange-500/10 px-2 py-0.5 font-display text-[0.68rem] font-bold uppercase tracking-wide text-orange-300">
                <Icon name="flame" className="h-3 w-3" />
                {daily.streak} {daily.streak === 1 ? 'daily' : 'dailies'} in a row
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {cleared ? (
            <>
              <span className="flex h-10 items-center gap-1.5 rounded-lg border border-emerald-400/40 bg-emerald-400/10 px-3 font-display text-xs font-bold uppercase tracking-[0.14em] text-emerald-300">
                <Icon name="check" className="h-4 w-4" />
                {daily.doneToday ? 'Done today' : 'Already cleared'}
              </span>
              {bonus ? (
                <Link to={problemLink(bonus.id)} state={FROM_BOARD} onClick={() => sfx.play('click')} className="btn-primary h-10 rounded-lg px-4 text-sm" title={bonus.title}>
                  <Icon name="play" className="h-4 w-4" />
                  <span className="max-w-[10rem] truncate">{bonus.title}</span>
                </Link>
              ) : (
                <button type="button" onClick={rollBonus} className="btn-ghost h-10 rounded-lg px-3 text-xs font-bold uppercase tracking-wide">
                  <Icon name="sparkles" className="h-4 w-4" />
                  Bonus quest
                </button>
              )}
            </>
          ) : (
            <Link to={problemLink(problem.id)} state={FROM_BOARD} onClick={() => sfx.play('click')} className="btn-primary h-10 rounded-lg px-5 text-sm">
              <Icon name="play" className="h-4 w-4" />
              Take it on
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
