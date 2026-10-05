import { useEffect, useRef, useState } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import confetti from 'canvas-confetti';
import { GUEST_LOCK_TOOLTIP, useAuth } from '../../auth/useAuth';
import { ApiError } from '../../lib/http';
import { usePlayerStats } from '../../lib/playerStatsContext';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { sfx } from '../../lib/sfx';
import type { useToasts } from '../../lib/useToasts';
import { JUDGE_RUNNING, pickRandom, streakToast, verdictFlavor } from '../../lib/flavorText';
import { AnimatedNumber } from '../../components/ui/AnimatedNumber';
import { Icon } from '../../components/ui/Icon';
import { LevelBadge } from '../../components/ui/LevelBadge';
import { Pips } from '../../components/ui/Pips';
import { XPBar } from '../../components/ui/XPBar';
import { fetchProblem, fetchScore, fetchSubmission, postSubmission, runExamples, type ProblemDetail, type RunResult, type ScoreResult, type SubmissionResult } from './api';
import { DifficultyBadge } from './DifficultyBadge';
import { difficultyMeta, padId } from './difficulty';
import { loadDraft, loadLanguage, saveDraft, saveLanguage, type Language } from './drafts';
import { pickNextAfter } from './nextQuest';
import { ExampleBlock, InlineText } from './RichText';
import { RunPanel } from './RunPanel';
import type { ProblemCatalog } from './useProblemCatalog';

const POLL_MS = 2000;
/** About two minutes of judging before we stop waiting on the screen. */
const MAX_POLLS = 60;
type CodeEditor = Parameters<OnMount>[0];

const MOD_KEY = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl';

const LANGUAGES: { id: Language; label: string; ext: string }[] = [
  { id: 'python', label: 'Python', ext: 'py' },
  { id: 'c++', label: 'C++', ext: 'cpp' },
];

function starterFor(problem: ProblemDetail, language: Language): string {
  return problem.boilerplate[language] || (language === 'python' ? 'def solve(*args, **kwargs):\n    pass\n' : '');
}

function verdictStyle(verdict: string) {
  if (verdict === 'AC') return { text: 'text-emerald-300', bg: 'from-emerald-950/70 to-slate-950/60', color: '#34d399' };
  if (verdict === 'PENDING') return { text: 'text-amber-300', bg: 'from-amber-950/50 to-slate-950/60', color: '#fbbf24' };
  return { text: 'text-rose-300', bg: 'from-rose-950/60 to-slate-950/60', color: '#fb7185' };
}

interface WorkspaceProps {
  id: number;
  catalog: ProblemCatalog;
  push: ReturnType<typeof useToasts>['push'];
  /** Counts consecutive accepted solves in this visit; returns the new streak. */
  recordVerdict: (accepted: boolean) => number;
  onBack: () => void;
  onNext: (id: number) => void;
}

/** One problem: the statement on the left, your code and the verdict on the right. */
export function ProblemWorkspace(props: WorkspaceProps) {
  const { flavorTextEnabled } = useAuth();
  const [state, setState] = useState<{ problem: ProblemDetail | null; error: string }>({ problem: null, error: '' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let ignore = false;
    fetchProblem(props.id)
      .then((problem) => {
        if (!ignore) setState({ problem, error: '' });
      })
      .catch((err: unknown) => {
        if (!ignore) setState({ problem: null, error: err instanceof ApiError && err.status === 404 ? 'That problem doesn’t exist.' : 'Couldn’t load this problem.' });
      });
    return () => {
      ignore = true;
    };
  }, [props.id, attempt]);

  return (
    <div className="hud-grid-bg min-h-[calc(100dvh-var(--nav-h))] flex-1">
      <div className="relative z-10 mx-auto max-w-[88rem] px-4 py-6 text-left md:px-8 md:py-8">
        <button
          type="button"
          onClick={props.onBack}
          className="group mb-4 inline-flex items-center gap-2 text-sm font-semibold text-slate-400 transition-colors hover:text-cyan-300"
        >
          <Icon name="arrowLeft" className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
          {flavorTextEnabled ? 'Back to the quest board' : 'Back to problems'}
        </button>

        {state.problem ? (
          <ProblemSession problem={state.problem} {...props} />
        ) : state.error ? (
          <div className="hud-panel hud-panel-quiet flex flex-wrap items-center gap-4 p-6">
            <p className="text-sm text-rose-400">{state.error}</p>
            <button
              type="button"
              onClick={() => {
                setState({ problem: null, error: '' });
                setAttempt((n) => n + 1);
              }}
              className="btn-ghost h-9 rounded-lg px-4 text-xs font-bold uppercase tracking-wide"
            >
              Try again
            </button>
          </div>
        ) : (
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]" aria-busy="true">
            <div className="h-96 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/50" />
            <div className="h-96 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/50" />
          </div>
        )}
      </div>
    </div>
  );
}

/** What to tell the player when "Run" could not produce a result. */
function runErrorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 429) return 'You’re running code too fast. Wait a few seconds and try again.';
    if (err.status === 503) return 'The code runner is busy right now. Try again in a moment.';
    if (err.status === 400) return err.message;
  }
  return 'Could not run your code. Try again in a moment.';
}

function ProblemSession({ problem, catalog, push, recordVerdict, onNext }: WorkspaceProps & { problem: ProblemDetail }) {
  const { user, isGuest, flavorTextEnabled } = useAuth();
  const { stats, refresh: refreshStats } = usePlayerStats();
  const fineKeyboard = useMediaQuery('(pointer: fine)');
  // Demo visitors share one draft slot instead of leaving a new one behind per session.
  const userId = isGuest ? 'guest' : (user?.userId ?? 'anon');
  const meta = difficultyMeta(problem.difficultyLevel);

  const [language, setLanguage] = useState<Language>(loadLanguage);
  // Each language keeps its own code, so switching tabs never throws work away.
  const [codes, setCodes] = useState<Record<Language, string>>(() => ({
    python: loadDraft(userId, problem.id, 'python') ?? starterFor(problem, 'python'),
    'c++': loadDraft(userId, problem.id, 'c++') ?? starterFor(problem, 'c++'),
  }));
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmissionResult | null>(null);
  const [score, setScore] = useState<ScoreResult | null>(null);
  const [submitError, setSubmitError] = useState('');
  const [runningLine, setRunningLine] = useState('');
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [runError, setRunError] = useState('');

  const code = codes[language];
  const starter = starterFor(problem, language);
  const dirty = code !== starter;
  const judging = result?.verdict === 'PENDING';
  const cleared = catalog.status[problem.id] === 'AC';
  const verdict = result ? verdictStyle(result.verdict) : null;
  const next = result?.verdict === 'AC' ? pickNextAfter(catalog.problems, catalog.status, problem.id) : null;

  const busyRef = useRef(false);
  const runningRef = useRef(false);
  const mountedRef = useRef(true);
  const lineTimer = useRef<number | undefined>(undefined);
  /** What Ctrl/Cmd+Enter does: submit for a player, run the examples for a demo visitor (who cannot submit). */
  const primaryRef = useRef<() => void>(() => {});
  const editorRef = useRef<CodeEditor | null>(null);
  const editorPanelRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      // Leaving mid-judge is fine: polling carries on in the background so the
      // verdict still lands (status, XP). Only the on-screen chatter stops.
      mountedRef.current = false;
      editorRef.current = null;
      window.clearInterval(lineTimer.current);
    };
  }, []);

  // Always point the shortcut at the latest handler.
  useEffect(() => {
    primaryRef.current = isGuest ? handleRun : handleSubmit;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        primaryRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function changeCode(value: string) {
    setCodes((prev) => ({ ...prev, [language]: value }));
    saveDraft(userId, problem.id, language, value, starter);
  }

  function switchLanguage(next: Language) {
    if (next === language) return;
    setLanguage(next);
    saveLanguage(next);
  }

  function resetCode() {
    if (!dirty) return;
    if (!window.confirm('Discard your code for this problem and go back to the starter template?')) return;
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (editor && model) {
      // a normal edit rather than setValue, so Ctrl+Z can still bring the code back;
      // the editor's change event then updates the state and the saved draft
      editor.pushUndoStop();
      editor.executeEdits('reset', [{ range: model.getFullModelRange(), text: starter }]);
      editor.pushUndoStop();
    } else {
      changeCode(starter);
    }
  }

  /** Nudge the page just far enough that the verdict is on screen (the tab bar covers the bottom on phones). */
  function revealResult() {
    window.requestAnimationFrame(() => {
      const el = resultRef.current;
      if (!el) return;
      const bottomInset = window.matchMedia('(max-width: 639px)').matches ? 100 : 24;
      const overflow = el.getBoundingClientRect().bottom - (window.innerHeight - bottomInset);
      if (overflow > 0) window.scrollBy({ top: overflow, behavior: 'smooth' });
    });
  }

  function settle(data: SubmissionResult) {
    const accepted = data.verdict === 'AC';
    catalog.markStatus(problem.id, accepted ? 'AC' : 'ATTEMPTED');
    const streak = recordVerdict(accepted);
    if (accepted) {
      if (mountedRef.current) {
        sfx.play('win');
        confetti({ particleCount: 150, spread: 90, origin: { y: 0.6 } });
      }
      fetchScore(data.id)
        .then((s) => {
          if (mountedRef.current) setScore(s);
        })
        .catch(() => {})
        // the score is final now: refresh level/XP/streak (and the level-up celebration)
        .finally(() => void refreshStats());
      if (streak >= 2 && flavorTextEnabled) push(streakToast(streak), 'success');
    } else if (mountedRef.current) {
      sfx.play('error');
    }
    if (mountedRef.current) revealResult();
  }

  function pollSubmission(submissionId: string) {
    window.clearInterval(lineTimer.current);
    setRunningLine(pickRandom(JUDGE_RUNNING));
    lineTimer.current = window.setInterval(() => setRunningLine(pickRandom(JUDGE_RUNNING)), 1400);

    let polls = 0;
    let failures = 0;
    let inFlight = false;
    const timer = window.setInterval(tick, POLL_MS);

    function stop() {
      window.clearInterval(timer);
      window.clearInterval(lineTimer.current);
      busyRef.current = false;
    }

    function giveUp() {
      stop();
      if (!mountedRef.current) return;
      setResult(null);
      setSubmitError('Lost contact with the judge. Your submission was received - check back in a moment.');
    }

    async function tick() {
      if (inFlight) return;
      inFlight = true;
      polls += 1;
      try {
        const data = await fetchSubmission(submissionId);
        failures = 0;
        if (mountedRef.current) setResult(data);
        if (data.verdict !== 'PENDING') {
          stop();
          settle(data);
        } else if (polls >= MAX_POLLS) {
          giveUp();
        }
      } catch {
        failures += 1;
        if (failures >= 3 || polls >= MAX_POLLS) giveUp();
      } finally {
        inFlight = false;
      }
    }
  }

  function handleRun() {
    if (runningRef.current) return;
    runningRef.current = true;
    sfx.play('click');
    setRunning(true);
    setRunError('');

    // Read the editor itself: React state can trail the last keystroke by a frame.
    const source = editorRef.current?.getValue() ?? code;
    runExamples({ problemId: problem.id, language, code: source })
      .then((data) => {
        if (!mountedRef.current) return;
        setRunResult(data);
        sfx.play(data.verdict === 'AC' ? 'win' : 'error');
      })
      .catch((err: unknown) => {
        if (!mountedRef.current) return;
        setRunResult(null);
        setRunError(runErrorText(err));
      })
      .finally(() => {
        runningRef.current = false;
        if (mountedRef.current) setRunning(false);
      });
  }

  function handleSubmit() {
    if (!user || isGuest || busyRef.current) return;
    busyRef.current = true;
    sfx.play('click');
    setSubmitting(true);
    setSubmitError('');
    setResult(null);
    setScore(null);

    // Read the editor itself: React state can trail the last keystroke by a frame.
    const source = editorRef.current?.getValue() ?? code;
    postSubmission({ problemId: problem.id, language, code: source })
      .then((data) => {
        if (mountedRef.current) setResult(data);
        pollSubmission(data.id);
      })
      .catch((err: unknown) => {
        busyRef.current = false;
        if (mountedRef.current) setSubmitError(err instanceof ApiError && err.status === 429 ? 'You’re submitting too fast. Wait a moment and try again.' : err instanceof Error ? err.message : 'Could not submit');
      })
      .finally(() => {
        if (mountedRef.current) setSubmitting(false);
      });
  }

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      {/* ------------------------------------------------------ briefing */}
      <section className="hud-panel p-5 md:p-6 animate-fade-in-up">
        <div className="flex flex-wrap items-center gap-2">
          <DifficultyBadge level={problem.difficultyLevel} />
          <span className="inline-flex items-center gap-1 rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 font-display text-[0.7rem] font-bold uppercase tracking-[0.12em] text-amber-300">
            <Icon name="bolt" className="h-3 w-3" />+{meta.xp} XP base
          </span>
          {cleared && (
            <span className="inline-flex items-center gap-1 rounded-md border border-emerald-400/40 bg-emerald-400/10 px-2 py-0.5 font-display text-[0.7rem] font-bold uppercase tracking-[0.12em] text-emerald-300">
              <Icon name="check" className="h-3 w-3" />
              Cleared
            </span>
          )}
          <span className="ml-auto font-mono text-xs font-bold text-slate-500">{padId(problem.id)}</span>
        </div>
        <h1 className="font-display mt-3 text-3xl font-bold leading-tight tracking-wide text-slate-50 md:text-4xl">{problem.title}</h1>

        <p className="mt-4 whitespace-pre-wrap text-[0.95rem] leading-relaxed text-slate-300">
          <InlineText text={problem.description} />
        </p>

        {problem.examples.length > 0 && (
          <>
            <h2 className="hud-label mb-2 mt-6 text-cyan-300">Examples</h2>
            <div className="space-y-2.5">
              {problem.examples.map((ex, i) => (
                <ExampleBlock key={i} example={ex} />
              ))}
            </div>
          </>
        )}

        {problem.constraints.length > 0 && (
          <>
            <h2 className="hud-label mb-2 mt-6 text-cyan-300">Constraints</h2>
            <ul className="space-y-1.5">
              {problem.constraints.map((c, i) => (
                <li key={i} className="flex gap-2.5 text-sm text-slate-400">
                  <span className="mt-[0.45rem] h-1.5 w-1.5 shrink-0 rotate-45 bg-cyan-400/70" />
                  <span>
                    <InlineText text={c} />
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        <button
          type="button"
          onClick={() => editorPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          className="btn-ghost mt-6 h-10 w-full gap-2 rounded-lg text-sm font-semibold lg:hidden"
        >
          Go to the editor <Icon name="chevronDown" className="h-4 w-4" />
        </button>
      </section>

      {/* ----------------------------------------------- code + verdict */}
      <section className="space-y-4 scroll-mt-20 lg:sticky lg:top-[calc(var(--nav-h)+1rem)]" ref={editorPanelRef}>
        <div className="hud-panel p-4 md:p-5 animate-fade-in-up" style={{ animationDelay: '90ms' }}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-sm font-bold uppercase tracking-[0.18em] text-slate-100">{flavorTextEnabled ? 'Deploy your solution' : 'Your solution'}</h2>
            <div className="flex items-center gap-2">
              {dirty && (
                <button
                  type="button"
                  onClick={resetCode}
                  title="Go back to the starter template"
                  className="btn-ghost h-8 gap-1.5 rounded-lg px-2.5 text-xs font-bold uppercase tracking-wide"
                >
                  <Icon name="rotate" className="h-3.5 w-3.5" />
                  Reset
                </button>
              )}
              <div className="flex rounded-lg border border-slate-700 bg-slate-950/60 p-0.5" role="tablist" aria-label="Language">
                {LANGUAGES.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    role="tab"
                    aria-selected={language === l.id}
                    onClick={() => switchLanguage(l.id)}
                    className={`rounded-md px-3.5 py-1 text-xs font-bold transition-colors ${language === l.id ? 'bg-cyan-400/20 text-cyan-200' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="h-[22rem] overflow-hidden rounded-lg border border-slate-700/80 lg:h-[clamp(300px,calc(100dvh-27rem),640px)]">
            <Editor
              height="100%"
              path={`problem-${problem.id}.${LANGUAGES.find((l) => l.id === language)?.ext}`}
              language={language === 'c++' ? 'cpp' : language}
              defaultValue={code}
              onChange={(value) => changeCode(value ?? '')}
              onMount={(editor, monaco) => {
                editorRef.current = editor;
                // a model kept from an earlier visit may predate a cleared draft
                if (editor.getValue() !== code) editor.setValue(code);
                // Monaco would otherwise use Ctrl/Cmd+Enter to insert a line.
                editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => primaryRef.current());
              }}
              theme="vs-dark"
              options={{ fontSize: 14, minimap: { enabled: false }, scrollBeyondLastLine: false, padding: { top: 12 }, automaticLayout: true }}
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleRun}
              disabled={running}
              title="Run your code on this problem's examples. Nothing is saved or scored."
              className={`h-11 gap-2 rounded-lg px-5 text-sm ${isGuest ? 'btn-primary' : 'btn-ghost font-semibold'}`}
            >
              {running ? (
                <>
                  <span className={`h-4 w-4 animate-spin rounded-full border-2 ${isGuest ? 'border-slate-900/30 border-t-slate-900' : 'border-slate-400/30 border-t-slate-200'}`} />
                  Running…
                </>
              ) : (
                <>
                  <Icon name="play" className="h-4 w-4" />
                  Run examples
                  {isGuest && fineKeyboard && (
                    <span className="ml-1 flex gap-1" aria-hidden="true">
                      <span className="keycap">{MOD_KEY}</span>
                      <span className="keycap">↵</span>
                    </span>
                  )}
                </>
              )}
            </button>
            {!isGuest && (
              <button type="button" onClick={handleSubmit} disabled={submitting || judging} className="btn-primary h-11 gap-2 rounded-lg px-6 text-sm">
                {submitting || judging ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-900/30 border-t-slate-900" />
                    {judging ? 'Judging…' : 'Deploying…'}
                  </>
                ) : (
                  <>
                    <Icon name="rocket" className="h-4 w-4" />
                    {flavorTextEnabled ? 'Deploy solution' : 'Submit'}
                    {fineKeyboard && (
                      <span className="ml-1 flex gap-1" aria-hidden="true">
                        <span className="keycap">{MOD_KEY}</span>
                        <span className="keycap">↵</span>
                      </span>
                    )}
                  </>
                )}
              </button>
            )}
            {isGuest && (
              <span
                className="inline-flex h-11 cursor-not-allowed items-center gap-2 rounded-lg border border-slate-700/80 px-4 text-sm font-semibold text-slate-500"
                title={GUEST_LOCK_TOOLTIP}
                aria-disabled="true"
              >
                <Icon name="lock" className="h-4 w-4" />
                {flavorTextEnabled ? 'Deploy solution' : 'Submit'}
              </span>
            )}
            {judging && flavorTextEnabled && <p className="text-sm text-amber-300/90 animate-pulse">{runningLine}</p>}
            {submitError && <p className="text-sm text-rose-400">{submitError}</p>}
            {runError && <p className="text-sm text-rose-400">{runError}</p>}
          </div>
          {isGuest && (
            <p className="mt-3 text-xs leading-relaxed text-slate-500">
              Demo mode: your code runs on this problem’s examples only. Submitting for score and territory needs a Thapar ID.
            </p>
          )}
        </div>

        {runResult && <RunPanel result={runResult} flavor={flavorTextEnabled} />}

        {result && verdict && (
          <div ref={resultRef} className={`hud-panel scroll-mt-24 overflow-hidden bg-gradient-to-br p-4 animate-pop-in md:p-5 ${verdict.bg}`} style={{ borderColor: `${verdict.color}66` }}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="hud-label !text-[0.64rem]">Verdict</p>
                <p className={`font-display text-3xl font-bold uppercase tracking-wide ${verdict.text}`}>{result.verdict === 'AC' ? 'Accepted' : result.verdict}</p>
                {flavorTextEnabled && !judging && result.verdict !== 'AC' && <p className="mt-0.5 text-sm text-slate-400">{verdictFlavor(result.verdict)}</p>}
              </div>
              <div className="text-right">
                <p className="hud-label !text-[0.64rem]">Tests</p>
                <p className="font-mono text-2xl font-bold tabular-nums text-slate-100">
                  {result.totalPassed}
                  <span className="text-slate-500">/{result.totalTests}</span>
                </p>
              </div>
            </div>
            {result.totalTests > 0 && (
              <Pips
                className="mt-3"
                filled={result.totalPassed}
                total={Math.min(result.totalTests, 24)}
                color={result.verdict === 'AC' ? '#34d399' : result.verdict === 'PENDING' ? '#fbbf24' : '#fb7185'}
              />
            )}

            {result.verdict === 'AC' && result.pointsAwarded === false && (
              <p className="mt-3 flex items-start gap-2 text-sm text-amber-300">
                <Icon name="lock" className="mt-0.5 h-4 w-4 shrink-0" />
                {result.noPointsReason === 'ALREADY_SOLVED'
                  ? "You've already earned points for this problem — no additional territory or score awarded."
                  : result.noPointsReason === 'DAILY_LIMIT'
                    ? "Daily submission limit reached — this solve won't count toward score today."
                    : 'No points awarded for this submission.'}
              </p>
            )}

            {result.verdict === 'AC' && score && (
              <div className="mt-4 flex items-center gap-4 border-t border-white/10 pt-4">
                <LevelBadge level={stats.level.level} size={46} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="font-mono text-2xl font-bold tabular-nums text-white">
                      +<AnimatedNumber value={score.totalScore * 10} /> <span className="text-sm text-amber-300">XP</span>
                    </p>
                    <p className="text-[0.7rem] font-semibold text-slate-400">
                      {stats.level.xpToNext} XP to level {stats.level.level + 1}
                    </p>
                  </div>
                  <XPBar pct={stats.level.pct} className="mt-1.5" />
                  <p className="mt-1.5 text-xs text-slate-500">
                    {flavorTextEnabled ? 'Territory captured · ' : ''}difficulty {score.difficultyWeight}
                    <span className="text-rose-400"> · retries −{score.attemptsPenalty.toFixed(1)}</span>
                    <span className="text-emerald-400"> · speed +{score.timeEfficiency.toFixed(1)}</span>
                  </p>
                </div>
              </div>
            )}

            {next && (
              <button type="button" onClick={() => onNext(next.id)} className="btn-primary mt-4 h-11 w-full gap-2 rounded-lg px-4 text-sm" title={next.title}>
                <span className="truncate">
                  Next quest
                  <span className="font-normal opacity-80">
                    {' · '}
                    {padId(next.id)} {next.title}
                  </span>
                </span>
                <Icon name="arrowRight" className="h-4 w-4 shrink-0" />
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
