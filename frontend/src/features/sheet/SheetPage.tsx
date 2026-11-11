import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { DailyQuestCard } from '../../components/DailyQuestCard';
import { FROM_BOARD, problemLink } from '../../lib/links';
import { AnimatedNumber } from '../../components/ui/AnimatedNumber';
import { Icon } from '../../components/ui/Icon';
import { ProgressRing } from '../../components/ui/ProgressRing';
import { sfx } from '../../lib/sfx';
import { useTheme } from '../../lib/theme';
import { DifficultyBadge } from '../problems/DifficultyBadge';
import { difficultyMeta, padId } from '../problems/difficulty';
import type { ProblemStatus, ProblemSummary } from '../problems/api';
import { useProblemCatalog } from '../problems/useProblemCatalog';
import {
  ALL_FRONTS,
  ALL_SHEET_IDS,
  REALMS,
  SHEET_TAGLINE,
  bossOf,
  catalogMap,
  coreOf,
  frontProgress,
  nextStep,
  realmProgress,
  sheetProgress,
  warpathRank,
  type Front,
  type Quest,
  type Realm,
} from './sheetData';

type StatusMap = Record<number, ProblemStatus>;

// ----------------------------------------------------------------- one quest

function QuestRow({
  position,
  quest,
  problem,
  state,
  isNext,
  isBoss,
  accent,
}: {
  position: number;
  quest: Quest;
  problem: ProblemSummary;
  state: ProblemStatus | undefined;
  isNext: boolean;
  isBoss: boolean;
  accent: string;
}) {
  const cleared = state === 'AC';
  const meta = difficultyMeta(problem.difficultyLevel);

  return (
    <li>
      <Link
        to={problemLink(problem.id)}
        state={FROM_BOARD}
        onClick={() => sfx.play('click')}
        className={`group relative flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-all hover:-translate-y-px sm:gap-4 sm:px-4 ${
          cleared
            ? 'border-emerald-500/30 bg-emerald-500/[0.06] hover:border-emerald-400/60'
            : isNext
              ? 'border-cyan-400/60 bg-cyan-400/[0.08] shadow-[0_0_24px_-10px_rgba(34,211,238,0.8)] hover:border-cyan-300'
              : 'border-slate-800 bg-slate-900/50 hover:border-slate-600'
        } ${quest.side ? 'border-dashed' : ''}`}
      >
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border font-mono text-xs font-bold ${
            cleared
              ? 'border-emerald-400/50 bg-emerald-400/15 text-emerald-300'
              : state === 'ATTEMPTED'
                ? 'border-amber-400/50 bg-amber-400/10 text-amber-300'
                : isNext
                  ? 'border-cyan-300/70 bg-cyan-400/15 text-cyan-200'
                  : 'border-slate-700 bg-slate-900/70 text-slate-500'
          }`}
          aria-hidden="true"
        >
          {cleared ? <Icon name="check" className="h-4 w-4" /> : state === 'ATTEMPTED' ? <Icon name="swords" className="h-4 w-4" /> : isNext ? <Icon name="play" filled className="h-3.5 w-3.5" /> : quest.side ? <Icon name="plus" className="h-3.5 w-3.5" /> : position}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-mono text-[0.64rem] font-bold text-slate-500">{padId(problem.id)}</span>
            <span className="truncate text-[0.92rem] font-semibold leading-snug text-slate-100" title={problem.title}>
              {problem.title}
            </span>
            {isBoss && (
              <span className="flex items-center gap-1 rounded px-1.5 py-px font-display text-[0.6rem] font-bold uppercase tracking-[0.16em]" style={{ color: accent, background: `${accent}1f`, border: `1px solid ${accent}55` }}>
                <Icon name="skull" className="h-3 w-3" />
                Boss
              </span>
            )}
            {quest.side && <span className="rounded border border-slate-700 px-1.5 py-px font-display text-[0.6rem] font-bold uppercase tracking-[0.16em] text-slate-500">Side quest</span>}
            {isNext && <span className="rounded bg-cyan-400/20 px-1.5 py-px font-display text-[0.6rem] font-bold uppercase tracking-[0.16em] text-cyan-200">You are here</span>}
            {state === 'ATTEMPTED' && <span className="font-display text-[0.62rem] font-bold uppercase tracking-[0.14em] text-amber-300">Retry</span>}
          </span>
          <span className="mt-0.5 block text-[0.78rem] leading-snug text-slate-400">{quest.lesson}</span>
        </span>

        <span className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
          <DifficultyBadge level={problem.difficultyLevel} />
          <span className="font-mono text-[0.64rem] font-bold text-slate-500">+{meta.xp} XP</span>
        </span>
        <Icon name="arrowRight" className="h-4 w-4 shrink-0 text-slate-600 transition-all group-hover:translate-x-0.5 group-hover:text-cyan-300" />
      </Link>
    </li>
  );
}

// ----------------------------------------------------------------- one front

function FrontCard({
  front,
  number,
  realm,
  accent,
  status,
  byId,
  open,
  onToggle,
  isCurrent,
  nextId,
  todoOnly,
  showSide,
}: {
  front: Front;
  number: number;
  realm: Realm;
  accent: string;
  status: StatusMap;
  byId: Map<number, ProblemSummary>;
  open: boolean;
  onToggle: () => void;
  isCurrent: boolean;
  nextId: number | null;
  todoOnly: boolean;
  showSide: boolean;
}) {
  const prog = frontProgress(front, status, byId);
  const boss = bossOf(front);
  const quests = front.quests.filter((q) => byId.has(q.id) && (showSide || !q.side) && !(todoOnly && status[q.id] === 'AC'));
  const positions = new Map<number, number>();
  front.quests.filter((q) => !q.side && byId.has(q.id)).forEach((q, i) => positions.set(q.id, i + 1));

  return (
    <li className="relative pl-9 sm:pl-12">
      {/* the spine: a node on the path, lit once the front is cleared */}
      <span
        className={`absolute left-0 top-5 flex h-[26px] w-[26px] items-center justify-center rounded-full border-2 sm:top-6 ${isCurrent && !prog.done ? 'animate-glow-pulse' : ''}`}
        style={{
          borderColor: prog.done || isCurrent ? accent : 'var(--color-slate-700)',
          background: prog.done ? accent : 'var(--color-slate-950)',
          color: prog.done ? '#04101a' : accent,
          boxShadow: prog.done ? `0 0 14px ${accent}99` : undefined,
        }}
        aria-hidden="true"
      >
        {prog.done ? <Icon name="check" className="h-3.5 w-3.5" strokeWidth={3} /> : <span className="font-mono text-[0.62rem] font-bold">{number}</span>}
      </span>

      <div
        className={`hud-panel hud-panel-quiet overflow-hidden transition-colors ${isCurrent && !prog.done ? '!border-cyan-400/50' : ''}`}
        style={prog.done ? { borderColor: `${accent}66` } : undefined}
      >
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 p-4 text-left sm:gap-4 sm:p-5">
          <span className="min-w-0 flex-1">
            <span className="hud-label flex flex-wrap items-center gap-x-2 gap-y-1">
              <span style={{ color: accent }}>Front {String(number).padStart(2, '0')}</span>
              {prog.done && (
                <span className="flex items-center gap-1 rounded px-1.5 py-px text-[0.6rem]" style={{ color: accent, background: `${accent}1f`, border: `1px solid ${accent}55` }}>
                  <Icon name="check" className="h-3 w-3" strokeWidth={3} />
                  Cleared
                </span>
              )}
              {isCurrent && !prog.done && <span className="rounded bg-cyan-400/20 px-1.5 py-px text-[0.6rem] text-cyan-200">Up next</span>}
            </span>
            <span className="font-display mt-0.5 block text-2xl font-bold leading-tight tracking-wide text-slate-50">{front.name}</span>
            <span className="mt-1 block max-w-2xl text-[0.85rem] leading-relaxed text-slate-400">{front.briefing}</span>
          </span>

          <span className="flex shrink-0 flex-col items-end gap-2">
            <span className="font-mono text-sm font-bold tabular-nums text-slate-200">
              {prog.cleared}
              <span className="text-slate-500">/{prog.total}</span>
            </span>
            <span className="flex gap-0.5" aria-hidden="true">
              {coreOf(front)
                .filter((q) => byId.has(q.id))
                .map((q) => (
                  <span
                    key={q.id}
                    className="h-1.5 w-2.5 rounded-sm sm:w-3"
                    style={{ background: status[q.id] === 'AC' ? accent : status[q.id] === 'ATTEMPTED' ? '#fbbf24' : 'var(--cc-track)' }}
                  />
                ))}
            </span>
            <Icon name={open ? 'chevronUp' : 'chevronDown'} className="h-4 w-4 text-slate-500" />
          </span>
        </button>

        {open && (
          <div className="border-t border-slate-800/80 px-3 pb-4 pt-4 sm:px-5">
            <div className="mb-4 flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-[0.82rem] leading-relaxed text-slate-300" style={{ background: `${accent}12`, border: `1px solid ${accent}33` }}>
              <Icon name="sparkles" className="mt-0.5 h-4 w-4 shrink-0" style={{ color: accent }} />
              <span>
                <strong className="font-display mr-1 uppercase tracking-wider" style={{ color: accent }}>
                  Pattern
                </strong>
                {front.pattern}
              </span>
            </div>

            {quests.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-500">Nothing left here. Switch the filter back to “All” to see the cleared quests.</p>
            ) : (
              <ol className="grid gap-2">
                {quests.map((q) => {
                  return (
                    <QuestRow
                      key={q.id}
                      position={positions.get(q.id) ?? 0}
                      quest={q}
                      problem={byId.get(q.id)!}
                      state={status[q.id]}
                      isNext={nextId === q.id}
                      isBoss={q.id === boss.id}
                      accent={accent}
                    />
                  );
                })}
              </ol>
            )}
            <p className="mt-3 text-[0.72rem] text-slate-500">
              {realm.name} · {prog.total} core quests{prog.sideTotal > 0 ? ` · ${prog.sideCleared}/${prog.sideTotal} side quests` : ''} · {prog.xpEarned.toLocaleString('en-US')}/{prog.xp.toLocaleString('en-US')} XP
            </p>
          </div>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------- the page

export default function SheetPage() {
  const { user, isDemo, flavorTextEnabled } = useAuth();
  const { isLight } = useTheme();
  const compact = useMediaQuery('(max-width: 639px)');
  const catalog = useProblemCatalog();
  const { problems, status, loading, error, retry } = catalog;

  const byId = useMemo(() => catalogMap(problems), [problems]);
  const prog = useMemo(() => sheetProgress(status, byId), [status, byId]);
  const next = useMemo(() => nextStep(status, byId), [status, byId]);
  const rank = warpathRank(prog.pct);

  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});
  const [todoOnly, setTodoOnly] = useState(false);
  const [showSide, setShowSide] = useState(true);
  const [howOpen, setHowOpen] = useState<boolean | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const isOpen = (front: Front) => openMap[front.id] ?? front.id === next?.front.id;
  const howShown = howOpen ?? prog.cleared === 0;
  const name = user?.name?.trim()?.split(/\s+/)[0] || 'Commander';
  const offSheet = problems.filter((p) => !ALL_SHEET_IDS.has(p.id)).length;
  const ringColor = isLight ? '#0891b2' : '#22d3ee';

  function toggle(front: Front) {
    sfx.play('click');
    setOpenMap((m) => ({ ...m, [front.id]: !isOpen(front) }));
  }

  function expandAll(open: boolean) {
    sfx.play('click');
    setOpenMap(Object.fromEntries(ALL_FRONTS.map((f) => [f.id, open])));
  }

  return (
    <div className="hud-grid-bg min-h-[calc(100dvh-var(--nav-h))] flex-1">
      <div className="relative z-10 mx-auto max-w-5xl px-4 py-6 text-left md:px-8 md:py-10">
        {/* ------------------------------------------------------------ hero */}
        <header className="hud-panel mb-5 overflow-hidden p-5 md:p-7 animate-fade-in-up">
          <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-cyan-400/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 left-10 h-60 w-60 rounded-full bg-violet-500/10 blur-3xl" />
          <div className="relative grid grid-cols-[1fr_auto] items-center gap-x-5 gap-y-4">
            <div className="min-w-0">
              <p className="hud-label text-cyan-300">{flavorTextEnabled ? `${isDemo ? 'Welcome' : `Welcome, ${name}`} · the CodeCraft DSA sheet` : 'The CodeCraft DSA sheet'}</p>
              <h1 className="font-display mt-1 text-5xl font-bold leading-none tracking-wide sm:text-6xl">
                <span className="text-slate-50">The </span>
                <span className="bg-gradient-to-r from-cyan-400 via-teal-300 to-emerald-300 bg-clip-text text-transparent drop-shadow-[0_0_14px_rgba(34,211,238,0.35)]">Warpath</span>
              </h1>
              <p className="mt-3 max-w-xl text-[0.95rem] leading-relaxed text-slate-300">
                {SHEET_TAGLINE} Arrays first, then trees, then graphs, in the order that makes each new idea feel like a small step.
              </p>
              <p className="mt-2 font-mono text-[0.72rem] font-bold uppercase tracking-wider text-slate-500">
                {prog.total} core quests · {prog.frontsTotal} fronts · {prog.realmsTotal} realms
              </p>
            </div>
            <div className="relative col-start-2 row-start-1 shrink-0 md:row-span-2">
              <ProgressRing pct={prog.pct} size={compact ? 84 : 132} stroke={compact ? 8 : 10} color={ringColor}>
                <div className="text-center leading-none">
                  <p className="font-mono text-xl font-bold tabular-nums text-slate-50 sm:text-3xl">
                    <AnimatedNumber value={prog.cleared} />
                  </p>
                  <p className="mt-1 text-[0.62rem] font-semibold uppercase tracking-wide text-slate-400">of {prog.total}</p>
                </div>
              </ProgressRing>
            </div>

            <div className="col-span-2 flex flex-wrap items-center gap-x-6 gap-y-3 md:col-span-1">
              {next ? (
                <Link
                  to={problemLink(next.quest.id)}
                  state={FROM_BOARD}
                  onClick={() => sfx.play('click')}
                  className="btn-primary h-11 max-w-full gap-2 rounded-lg px-5 text-sm"
                  title={byId.get(next.quest.id)?.title}
                >
                  <Icon name={next.retry ? 'swords' : 'play'} className="h-4 w-4 shrink-0" />
                  <span className="truncate">
                    {next.retry ? 'Retry' : prog.cleared === 0 ? 'Begin the Warpath' : 'Continue'}
                    <span className="font-normal opacity-80"> · {byId.get(next.quest.id)?.title}</span>
                  </span>
                </Link>
              ) : (
                !loading && problems.length > 0 && <p className="text-sm font-semibold text-emerald-300">The Warpath is cleared. Take a bow, Warlord.</p>
              )}
              <div className="flex items-center gap-2.5">
                <div className="relative h-9 w-9 shrink-0">
                  <div className="hex absolute inset-0 bg-gradient-to-b from-amber-200 via-amber-400 to-amber-600" />
                  <div className="hex absolute inset-[2px] flex items-center justify-center bg-gradient-to-b from-[#1d293d] to-[#020618]">
                    <Icon name="crown" className="h-4 w-4 text-amber-300" />
                  </div>
                </div>
                <div className="leading-tight">
                  <p className="hud-label !text-[0.58rem]">Warpath rank</p>
                  <p className="font-display text-base font-bold uppercase tracking-wide text-amber-300">{rank}</p>
                </div>
              </div>
            </div>
          </div>

          <dl className="relative mt-5 grid grid-cols-3 gap-2 border-t border-slate-800/80 pt-4 text-center sm:gap-4">
            {[
              { label: 'Fronts cleared', value: `${prog.frontsDone}/${prog.frontsTotal}` },
              { label: 'Realms cleared', value: `${prog.realmsDone}/${prog.realmsTotal}` },
              { label: 'Sheet XP', value: `${prog.xpEarned.toLocaleString('en-US')}` },
            ].map((s) => (
              <div key={s.label}>
                <dd className="font-mono text-xl font-bold tabular-nums text-slate-50 sm:text-2xl">{s.value}</dd>
                <dt className="hud-label !text-[0.6rem]">{s.label}</dt>
              </div>
            ))}
          </dl>
        </header>

        {/* ---------------------------------------------------- daily quest */}
        <DailyQuestCard catalog={catalog} className="mb-5" />

        {/* ----------------------------------------------------- how it works */}
        <section className="hud-panel hud-panel-quiet mb-6 overflow-hidden animate-fade-in-up">
          <button type="button" onClick={() => setHowOpen(!howShown)} aria-expanded={howShown} className="flex w-full items-center gap-2.5 px-4 py-3 text-left">
            <Icon name="book" className="h-4 w-4 text-cyan-400" />
            <span className="font-display text-sm font-bold uppercase tracking-[0.16em] text-slate-100">How to walk the Warpath</span>
            <span className="ml-auto">
              <Icon name={howShown ? 'chevronUp' : 'chevronDown'} className="h-4 w-4 text-slate-500" />
            </span>
          </button>
          {howShown && (
            <ol className="grid gap-3 border-t border-slate-800/80 px-4 pb-4 pt-4 sm:grid-cols-3">
              {[
                { icon: 'book', title: 'Read the briefing', body: 'Each front opens with a short note on the idea and the pattern to spot. Read it before you code.' },
                { icon: 'flag', title: 'Go in order', body: 'Core quests run easy to hard, one new idea at a time. Do them top to bottom. Side quests are extra reps if you want them.' },
                { icon: 'skull', title: 'Beat the boss', body: 'The last core quest of a front is its boss. Clear it and the front is yours. Stuck? Retries only cost a little score.' },
              ].map((s, i) => (
                <li key={s.title} className="flex gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-cyan-400/40 bg-cyan-400/10 font-display text-sm font-bold text-cyan-300">{i + 1}</span>
                  <span>
                    <span className="flex items-center gap-1.5 text-sm font-bold text-slate-100">
                      <Icon name={s.icon as 'book'} className="h-3.5 w-3.5 text-slate-400" />
                      {s.title}
                    </span>
                    <span className="mt-0.5 block text-[0.8rem] leading-relaxed text-slate-400">{s.body}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* ------------------------------------------------------- filters */}
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl border border-slate-700/80 bg-slate-950/50 p-0.5" role="group" aria-label="Show">
            {[
              { v: false, label: 'All' },
              { v: true, label: 'To do' },
            ].map((o) => (
              <button
                key={o.label}
                type="button"
                aria-pressed={todoOnly === o.v}
                onClick={() => {
                  sfx.play('click');
                  setTodoOnly(o.v);
                }}
                className={`h-9 rounded-[0.6rem] px-3.5 text-xs font-bold uppercase tracking-wide transition-colors ${todoOnly === o.v ? 'bg-cyan-400/15 text-cyan-200' : 'text-slate-400 hover:text-slate-200'}`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-pressed={showSide}
            onClick={() => {
              sfx.play('click');
              setShowSide(!showSide);
            }}
            className={`h-10 rounded-xl border px-3.5 text-xs font-bold uppercase tracking-wide transition-colors ${
              showSide ? 'border-cyan-400/50 bg-cyan-400/10 text-cyan-200' : 'border-slate-700/80 text-slate-400 hover:text-slate-200'
            }`}
          >
            Side quests {showSide ? 'on' : 'off'}
          </button>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={() => expandAll(true)} className="btn-ghost h-10 rounded-xl px-3 text-xs font-bold uppercase tracking-wide">
              Expand all
            </button>
            <button type="button" onClick={() => expandAll(false)} className="btn-ghost h-10 rounded-xl px-3 text-xs font-bold uppercase tracking-wide">
              Collapse
            </button>
          </div>
        </div>

        {/* ------------------------------------------------------- realms */}
        <div ref={listRef}>
          {error && (
            <div className="hud-panel hud-panel-quiet mb-6 flex flex-wrap items-center gap-4 p-5">
              <p className="text-sm text-rose-400">Couldn’t load the problems: {error}</p>
              <button type="button" onClick={retry} className="btn-primary h-9 rounded-lg px-4 text-sm">
                Try again
              </button>
            </div>
          )}
          {loading && (
            <div className="grid gap-3">
              {Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="h-28 animate-pulse rounded-xl border border-slate-800 bg-slate-900/50" />
              ))}
            </div>
          )}

          {!loading &&
            !error &&
            REALMS.map((realm) => {
              const accent = isLight ? realm.deep : realm.color;
              const rp = realmProgress(realm, status, byId);
              return (
                <section key={realm.id} className="mb-9" aria-label={realm.name}>
                  <div
                    className="hud-panel mb-4 overflow-hidden p-4 sm:p-5 animate-fade-in-up"
                    style={{ borderColor: `${accent}77`, background: `linear-gradient(120deg, ${accent}${isLight ? '26' : '22'}, transparent 65%)` }}
                  >
                    <div className="flex items-center gap-4">
                      <div className="relative h-14 w-14 shrink-0" style={{ filter: `drop-shadow(0 0 12px ${accent}88)` }}>
                        <div className="hex absolute inset-0" style={{ background: `linear-gradient(160deg, ${accent}, ${accent}55)` }} />
                        <div className="hex absolute inset-[2px] flex items-center justify-center bg-slate-950">
                          <Icon name={rp.done ? 'check' : realm.icon} className="h-6 w-6" style={{ color: accent }} />
                        </div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="hud-label" style={{ color: accent }}>
                          Realm {REALMS.indexOf(realm) + 1} of {REALMS.length}
                          {rp.done ? ' · cleared' : ''}
                        </p>
                        <h2 className="font-display text-3xl font-bold uppercase leading-tight tracking-wide text-slate-50">{realm.name}</h2>
                        <p className="mt-0.5 max-w-2xl text-[0.85rem] leading-snug text-slate-400">{realm.tagline}</p>
                      </div>
                      <div className="hidden shrink-0 text-right sm:block">
                        <p className="font-mono text-2xl font-bold tabular-nums text-slate-50">
                          {rp.cleared}
                          <span className="text-slate-500">/{rp.total}</span>
                        </p>
                        <p className="hud-label !text-[0.58rem]">
                          {rp.frontsDone}/{rp.frontsTotal} fronts
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--cc-track)' }}>
                      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${rp.total ? (rp.cleared / rp.total) * 100 : 0}%`, background: accent, boxShadow: `0 0 10px ${accent}99` }} />
                    </div>
                  </div>

                  <ol className="relative grid gap-4 before:absolute before:bottom-6 before:left-[12px] before:top-6 before:w-0.5 before:rounded-full before:bg-slate-700/60 sm:before:left-[12px]">
                    {realm.fronts.map((front) => {
                      return (
                        <FrontCard
                          key={front.id}
                          front={front}
                          number={ALL_FRONTS.indexOf(front) + 1}
                          realm={realm}
                          accent={accent}
                          status={status}
                          byId={byId}
                          open={isOpen(front)}
                          onToggle={() => toggle(front)}
                          isCurrent={next?.front.id === front.id}
                          nextId={next?.quest.id ?? null}
                          todoOnly={todoOnly}
                          showSide={showSide}
                        />
                      );
                    })}
                  </ol>
                </section>
              );
            })}

          {!loading && !error && (
            <p className="mb-4 text-center text-xs leading-relaxed text-slate-500">
              {offSheet > 0 ? `${offSheet} more problems (like input-validation puzzles) live on the Problems page but are not part of the Warpath. ` : ''}
              Every quest here is a real CodeCraft problem, so clearing it scores exactly as it does anywhere else on the site.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
