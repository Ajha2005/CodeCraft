import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { usePlayerStats } from '../../lib/playerStatsContext';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { sfx } from '../../lib/sfx';
import { EMPTY_PROBLEM_LIST, PROBLEM_HOVER_REMATCH, PROBLEM_HOVER_UNSOLVED, pickRandom } from '../../lib/flavorText';
import { AnimatedNumber } from '../../components/ui/AnimatedNumber';
import { Icon } from '../../components/ui/Icon';
import { Pips } from '../../components/ui/Pips';
import { ProgressRing } from '../../components/ui/ProgressRing';
import { DifficultyBadge } from './DifficultyBadge';
import { DIFFICULTIES, difficultyMeta, padId } from './difficulty';
import { pickNextUp } from './nextQuest';
import type { ProblemCatalog } from './useProblemCatalog';
import type { ProblemStatus, ProblemSummary } from './api';

const PAGE_SIZE = 20;

type StatusFilter = 'all' | 'todo' | 'retry' | 'cleared';

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'todo', label: 'To do' },
  { id: 'retry', label: 'Retry' },
  { id: 'cleared', label: 'Cleared' },
];

function matchesStatus(filter: StatusFilter, status: ProblemStatus | undefined) {
  if (filter === 'todo') return !status;
  if (filter === 'retry') return status === 'ATTEMPTED';
  if (filter === 'cleared') return status === 'AC';
  return true;
}

/** Every word must appear in the title; a number matches the problem id (`#12`, `012`, `12`). */
function matchesQuery(problem: ProblemSummary, query: string) {
  const q = query.trim().toLowerCase().replace(/^#/, '');
  if (!q) return true;
  const title = problem.title.toLowerCase();
  const id = String(problem.id).padStart(3, '0');
  return q.split(/\s+/).every((word) => (/^\d+$/.test(word) ? id.includes(word) : title.includes(word)));
}

function isTypingTarget(t: EventTarget | null) {
  return t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
}

interface QuestBoardProps {
  catalog: ProblemCatalog;
  /** The board stays mounted (so its filters survive) while a problem is open. */
  active: boolean;
  onOpen: (id: number) => void;
}

export function QuestBoard({ catalog, active, onOpen }: QuestBoardProps) {
  const { problems, status, loading, error, retry } = catalog;
  const { user, flavorTextEnabled } = useAuth();
  const { stats } = usePlayerStats();
  const compact = useMediaQuery('(max-width: 639px)');

  const [query, setQuery] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // "/" jumps to the search box, like on most sites with long lists.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  const progress = useMemo(() => {
    const byLevel: Record<string, { total: number; solved: number }> = {};
    let solved = 0;
    for (const p of problems) {
      const row = (byLevel[p.difficultyLevel] ??= { total: 0, solved: 0 });
      row.total++;
      if (status[p.id] === 'AC') {
        row.solved++;
        solved++;
      }
    }
    return { byLevel, solved };
  }, [problems, status]);

  const nextUp = useMemo(() => pickNextUp(problems, status), [problems, status]);

  const filtered = useMemo(
    () => problems.filter((p) => (!difficulty || p.difficultyLevel === difficulty) && matchesStatus(statusFilter, status[p.id]) && matchesQuery(p, query)),
    [problems, status, difficulty, statusFilter, query],
  );

  const filtersActive = query.trim() !== '' || difficulty !== '' || statusFilter !== 'all';
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const visible = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  function clearFilters() {
    setQuery('');
    setDifficulty('');
    setStatusFilter('all');
    setPage(1);
  }

  function goToPage(next: number) {
    setPage(next);
    listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const name = user?.name?.trim()?.split(/\s+/)[0] || user?.email?.split('@')[0] || 'Commander';
  const solvedPct = problems.length > 0 ? Math.min(1, progress.solved / problems.length) : 0;

  return (
    <div className="hud-grid-bg min-h-[calc(100dvh-var(--nav-h))] flex-1">
      <div className="relative z-10 mx-auto max-w-6xl px-4 py-6 text-left md:px-8 md:py-10">
        {/* ------------------------------------------------------------ hero */}
        <header className="hud-panel mb-6 grid grid-cols-[1fr_auto] items-center gap-x-5 gap-y-4 overflow-hidden p-5 md:p-7 animate-fade-in-up">
          <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-cyan-400/10 blur-3xl" />
          <div className="relative col-start-1 min-w-0">
            <p className="hud-label text-cyan-300">{flavorTextEnabled ? `Welcome back, ${name}` : 'Problems'}</p>
            <h1 className="font-display mt-1 text-4xl font-bold leading-none tracking-wide text-slate-50 sm:text-5xl">{flavorTextEnabled ? 'Quest board' : 'Problems'}</h1>
            <p className="mt-3 max-w-lg text-sm leading-relaxed text-slate-400">
              {flavorTextEnabled
                ? 'Pick a front, clear it, and claim the ground. Every accepted solve earns XP and a cell of campus.'
                : 'Solve problems to earn score and territory on the campus map.'}
            </p>
          </div>

          <div className="relative col-span-2 flex flex-wrap items-center gap-x-6 gap-y-3 md:col-span-1 md:col-start-1 md:row-start-2">
              {nextUp ? (
                <button type="button" onClick={() => onOpen(nextUp.problem.id)} className="btn-primary h-11 max-w-full gap-2 rounded-lg px-5 text-sm" title={nextUp.problem.title}>
                  <Icon name={nextUp.kind === 'retry' ? 'swords' : 'play'} className="h-4 w-4 shrink-0" />
                  <span className="truncate">
                    {nextUp.kind === 'retry' ? 'Retry' : nextUp.first ? 'Start your first quest' : 'Next quest'}
                    <span className="font-normal opacity-80">
                      {' · '}
                      {padId(nextUp.problem.id)} {nextUp.problem.title}
                    </span>
                  </span>
                </button>
              ) : (
                problems.length > 0 && <p className="text-sm font-semibold text-emerald-300">Every quest cleared. Nicely done.</p>
              )}
              {stats.daily && (
                <div className="w-36" title="Qualifying solves today">
                  <p className="hud-label !text-[0.58rem] mb-1">
                    Today · {stats.daily.qualifyingCount}/{stats.daily.cap}
                  </p>
                  <Pips filled={Math.min(stats.daily.qualifyingCount, stats.daily.cap)} total={stats.daily.cap} />
                </div>
              )}
          </div>

          <div className="relative col-start-2 row-start-1 shrink-0 md:row-span-2 md:self-center">
            <ProgressRing pct={solvedPct} size={compact ? 80 : 132} stroke={compact ? 7 : 10} color="#22d3ee">
              <div className="text-center leading-none">
                <p className={`font-mono font-bold tabular-nums text-white ${compact ? 'text-lg' : 'text-3xl'}`}>
                  <AnimatedNumber value={progress.solved} />
                </p>
                <p className="mt-1 text-[0.62rem] font-semibold uppercase tracking-wide text-slate-400">of {problems.length}</p>
              </div>
            </ProgressRing>
          </div>
        </header>

        {/* --------------------------------------------------------- filters */}
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-3">
          <label className="relative block w-full sm:w-60">
            <span className="sr-only">Search problems</span>
            <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              ref={searchRef}
              type="text"
              inputMode="search"
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  if (query) setQuery('');
                  else e.currentTarget.blur();
                }
              }}
              placeholder="Search by name or #"
              className="h-10 w-full rounded-xl border border-slate-700 bg-slate-950/60 pl-9 pr-9 text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-500 focus:border-cyan-400/70"
            />
            {query ? (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setPage(1);
                  searchRef.current?.focus();
                }}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 transition-colors hover:text-slate-100"
              >
                <Icon name="x" className="h-4 w-4" />
              </button>
            ) : (
              <span className="keycap pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 max-sm:hidden" aria-hidden="true">
                /
              </span>
            )}
          </label>

          <div className="flex flex-wrap gap-2" role="group" aria-label="Difficulty">
            {(['', ...DIFFICULTIES] as const).map((d) => {
              const meta = d ? difficultyMeta(d) : null;
              const active = difficulty === d;
              const row = d ? progress.byLevel[d] : { total: problems.length, solved: progress.solved };
              return (
                <button
                  key={d || 'all'}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    sfx.play('click');
                    setDifficulty(d);
                    setPage(1);
                  }}
                  className="flex h-10 items-center gap-2 rounded-xl border px-3.5 text-sm font-bold transition-colors"
                  style={
                    active
                      ? {
                          color: meta ? meta.accent : '#04101a',
                          borderColor: meta ? `${meta.accent}99` : '#e2e8f0',
                          background: meta ? `${meta.accent}1f` : 'linear-gradient(135deg,#f1f5f9,#cbd5e1)',
                        }
                      : { color: '#94a3b8', borderColor: 'rgba(71,85,105,0.7)', background: 'rgba(15,23,42,0.5)' }
                  }
                >
                  {meta && <Icon name={meta.icon} className="h-4 w-4" />}
                  {d || 'All'}
                  {row && (
                    <span className="font-mono text-[0.68rem] font-semibold tabular-nums opacity-60">
                      {d ? `${row.solved}/${row.total}` : row.total}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex rounded-xl border border-slate-700/80 bg-slate-950/50 p-0.5 sm:ml-auto" role="group" aria-label="Status">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={statusFilter === f.id}
                onClick={() => {
                  setStatusFilter(f.id);
                  setPage(1);
                }}
                className={`h-9 rounded-[0.6rem] px-3 text-xs font-bold uppercase tracking-wide transition-colors ${
                  statusFilter === f.id ? 'bg-cyan-400/15 text-cyan-200' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {filtersActive && !loading && !error && (
          <div className="mb-3 flex items-center justify-between text-xs text-slate-400" aria-live="polite">
            <span>
              {filtered.length} of {problems.length} problems
            </span>
            <button type="button" onClick={clearFilters} className="font-bold uppercase tracking-wide text-cyan-300 transition-colors hover:text-cyan-200">
              Clear filters
            </button>
          </div>
        )}

        {/* ------------------------------------------------------------ list */}
        <div ref={listRef} className="scroll-mt-24">
          {error && (
            <div className="hud-panel hud-panel-quiet mb-6 flex flex-wrap items-center gap-4 p-5">
              <p className="text-sm text-rose-400">Couldn’t load the problems: {error}</p>
              <button type="button" onClick={retry} className="btn-primary h-9 rounded-lg px-4 text-sm">
                Try again
              </button>
            </div>
          )}

          {loading && (
            <div className="mb-6 grid gap-3 sm:grid-cols-2">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="h-24 animate-pulse rounded-xl border border-slate-800 bg-slate-900/50" />
              ))}
            </div>
          )}

          {!loading && !error && filtered.length === 0 && (
            <div className="hud-panel hud-panel-quiet mb-6 p-8 text-center">
              <Icon name="search" className="mx-auto h-8 w-8 text-slate-600" />
              <p className="mt-3 text-sm text-slate-400">
                {problems.length === 0 ? (flavorTextEnabled ? EMPTY_PROBLEM_LIST : 'No problems found.') : 'No problems match.'}
              </p>
              {filtersActive && (
                <button type="button" onClick={clearFilters} className="btn-ghost mt-4 h-9 rounded-lg px-4 text-xs font-bold uppercase tracking-wide">
                  Clear filters
                </button>
              )}
            </div>
          )}

          <div className="mb-8 grid gap-3 sm:grid-cols-2">
            {visible.map((p, i) => {
              const st = status[p.id];
              const meta = difficultyMeta(p.difficultyLevel);
              const hoverTitle = flavorTextEnabled
                ? st === 'AC'
                  ? undefined
                  : st === 'ATTEMPTED'
                    ? pickRandom(PROBLEM_HOVER_REMATCH)
                    : pickRandom(PROBLEM_HOVER_UNSOLVED)
                : undefined;

              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    sfx.play('click');
                    onOpen(p.id);
                  }}
                  title={hoverTitle}
                  style={{ animationDelay: `${Math.min(i, 12) * 40}ms`, ['--accent' as string]: meta.accent }}
                  className={`group relative overflow-hidden rounded-xl border bg-slate-900/60 p-4 pl-5 text-left transition-all duration-200 hover:-translate-y-0.5 animate-fade-in-up ${
                    st === 'AC' ? 'border-emerald-500/40 hover:border-emerald-400/70' : 'border-slate-800 hover:border-[color:var(--accent)]'
                  }`}
                >
                  <span className="absolute inset-y-0 left-0 w-1" style={{ background: meta.accent, opacity: 0.7 }} />
                  {st === 'AC' && (
                    <span className="absolute right-3 top-3 flex items-center gap-1 font-display text-[0.64rem] font-bold uppercase tracking-[0.14em] text-emerald-300">
                      <Icon name="check" className="h-3 w-3" />
                      Cleared
                    </span>
                  )}
                  {st === 'ATTEMPTED' && (
                    <span className="absolute right-3 top-3 flex items-center gap-1 font-display text-[0.64rem] font-bold uppercase tracking-[0.14em] text-amber-300">
                      <Icon name="swords" className="h-3 w-3" />
                      Retry
                    </span>
                  )}

                  <p className="font-mono text-[0.66rem] font-bold text-slate-500">{padId(p.id)}</p>
                  <p className={`mt-0.5 text-[0.95rem] font-semibold leading-snug text-slate-100 ${st ? 'pr-20' : 'pr-2'}`}>{p.title}</p>
                  <div className="mt-3">
                    <DifficultyBadge level={p.difficultyLevel} />
                  </div>
                </button>
              );
            })}
          </div>

          {pageCount > 1 && (
            <div className="flex items-center justify-between gap-3 text-sm">
              <button type="button" disabled={current === 1} onClick={() => goToPage(current - 1)} className="btn-ghost h-10 rounded-lg px-4 font-semibold">
                <Icon name="arrowLeft" className="h-4 w-4" /> Previous
              </button>
              <span className="font-mono text-xs font-bold tabular-nums text-slate-500">
                {(current - 1) * PAGE_SIZE + 1}–{Math.min(current * PAGE_SIZE, filtered.length)} of {filtered.length}
              </span>
              <button type="button" disabled={current === pageCount} onClick={() => goToPage(current + 1)} className="btn-ghost h-10 rounded-lg px-4 font-semibold">
                Next <Icon name="arrowRight" className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
