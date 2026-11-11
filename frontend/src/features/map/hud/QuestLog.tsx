import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../../auth/useAuth';
import { FROM_BOARD, problemLink } from '../../../lib/links';
import { Icon } from '../../../components/ui/Icon';
import { LevelBadge } from '../../../components/ui/LevelBadge';
import { Pips } from '../../../components/ui/Pips';
import { StreakFlame } from '../../../components/ui/StreakFlame';
import { XPBar } from '../../../components/ui/XPBar';
import { dailyProblem, todayKey, useDailyState } from '../../../lib/daily';
import { usePlayerStats } from '../../../lib/playerStatsContext';
import { sfx } from '../../../lib/sfx';
import { useProblemCatalog } from '../../problems/useProblemCatalog';
import { catalogMap, nextStep, sheetProgress } from '../../sheet/sheetData';

const OPEN_KEY = 'cc.map.questlog.v1';

function readOpen(): boolean {
  try {
    const saved = localStorage.getItem(OPEN_KEY);
    if (saved !== null) return saved === '1';
  } catch {
    // fall through to the default
  }
  // Open on a roomy screen, folded away on a phone where the map needs the space.
  return !window.matchMedia('(max-width: 639px)').matches;
}

/**
 * The map's "what should I do next" panel. It keeps the game and the learning
 * in one place: your level and streak, today's optional Daily Quest, and the
 * next step on the Warpath. Every row is a link that takes you straight to a
 * problem, so the map is a launch pad for practice, not a detour from it.
 */
export function QuestLog({ explored, zoneTotal }: { explored: number; zoneTotal: number }) {
  const { user, isDemo } = useAuth();
  const { stats } = usePlayerStats();
  const catalog = useProblemCatalog();
  const daily = useDailyState(user?.userId);
  const [open, setOpen] = useState(readOpen);

  const byId = useMemo(() => catalogMap(catalog.problems), [catalog.problems]);
  const next = useMemo(() => nextStep(catalog.status, byId), [catalog.status, byId]);
  const prog = useMemo(() => sheetProgress(catalog.status, byId), [catalog.status, byId]);
  const dailyPick = useMemo(() => dailyProblem(catalog.problems, todayKey()), [catalog.problems]);
  const dailyDone = !!dailyPick && catalog.status[dailyPick.id] === 'AC';

  const streak = stats.streak?.current ?? 0;
  const name = user?.name?.trim()?.split(/\s+/)[0] || 'Commander';

  function toggle() {
    sfx.play('click');
    const nextOpen = !open;
    setOpen(nextOpen);
    try {
      localStorage.setItem(OPEN_KEY, nextOpen ? '1' : '0');
    } catch {
      // a convenience only
    }
  }

  return (
    <div className="hud-panel hud-panel-quiet w-[17.5rem] max-w-[calc(100vw-1.5rem)] animate-slide-in-left max-sm:w-[15.5rem]">
      <button type="button" onClick={toggle} aria-expanded={open} className="flex w-full items-center gap-2.5 p-2.5 text-left">
        <LevelBadge level={stats.level.level} size={38} />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-[0.82rem] font-semibold text-slate-100">{isDemo ? 'Guest' : name}</span>
          <span className="mt-1 flex items-center gap-1.5">
            <XPBar pct={stats.level.pct} className="!h-1.5 flex-1" />
            <span className="font-mono text-[0.6rem] font-bold tabular-nums text-amber-300/90">{stats.level.xpToNext} XP</span>
          </span>
        </span>
        {streak > 0 && (
          <span className="flex items-center gap-0.5" title={`${streak}-day streak`}>
            <StreakFlame days={streak} size={22} />
            <span className="font-mono text-xs font-bold tabular-nums text-orange-300">{streak}</span>
          </span>
        )}
        <Icon name={open ? 'chevronUp' : 'chevronDown'} className="h-4 w-4 shrink-0 text-slate-500" />
      </button>

      {open && (
        <div className="grid gap-1.5 border-t border-slate-700/50 p-2.5 pt-2">
          {stats.daily && (
            <div title="Qualifying solves today">
              <p className="hud-label !text-[0.56rem] mb-1">
                Today · {stats.daily.qualifyingCount}/{stats.daily.cap} solves
              </p>
              <Pips filled={Math.min(stats.daily.qualifyingCount, stats.daily.cap)} total={stats.daily.cap} />
            </div>
          )}

          {dailyPick && (
            <Link
              to={problemLink(dailyPick.id)}
              state={FROM_BOARD}
              onClick={() => sfx.play('click')}
              className="group flex items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-400/[0.07] px-2.5 py-2 transition-colors hover:border-amber-300/70"
            >
              <Icon name={dailyDone ? 'check' : 'gift'} className={`h-4 w-4 shrink-0 ${dailyDone ? 'text-emerald-300' : 'text-amber-300'}`} />
              <span className="min-w-0 flex-1 leading-tight">
                <span className="hud-label block !text-[0.54rem] !text-amber-300">Daily quest · optional{daily.streak > 0 ? ` · ${daily.streak} in a row` : ''}</span>
                <span className="block truncate text-[0.78rem] font-semibold text-slate-100">{dailyPick.title}</span>
              </span>
              <Icon name="arrowRight" className="h-3.5 w-3.5 shrink-0 text-slate-500 transition-all group-hover:translate-x-0.5 group-hover:text-amber-300" />
            </Link>
          )}

          {next && (
            <Link
              to={problemLink(next.quest.id)}
              state={FROM_BOARD}
              onClick={() => sfx.play('click')}
              className="group flex items-center gap-2 rounded-lg border border-cyan-400/30 bg-cyan-400/[0.07] px-2.5 py-2 transition-colors hover:border-cyan-300/70"
            >
              <Icon name={next.retry ? 'swords' : 'route'} className="h-4 w-4 shrink-0 text-cyan-300" />
              <span className="min-w-0 flex-1 leading-tight">
                <span className="hud-label block !text-[0.54rem] !text-cyan-300">Warpath · {next.front.name}</span>
                <span className="block truncate text-[0.78rem] font-semibold text-slate-100">{byId.get(next.quest.id)?.title}</span>
              </span>
              <Icon name="arrowRight" className="h-3.5 w-3.5 shrink-0 text-slate-500 transition-all group-hover:translate-x-0.5 group-hover:text-cyan-300" />
            </Link>
          )}

          <div className="flex items-center justify-between gap-2 pt-0.5 text-[0.66rem] text-slate-400">
            <Link to="/sheet" onClick={() => sfx.play('click')} className="font-bold uppercase tracking-wide text-cyan-300 hover:underline">
              Warpath {prog.cleared}/{prog.total}
            </Link>
            <span className="flex items-center gap-1 font-mono font-bold tabular-nums" title="Zones explored on the map">
              <Icon name="compass" className="h-3 w-3" />
              {explored}/{zoneTotal} explored
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
