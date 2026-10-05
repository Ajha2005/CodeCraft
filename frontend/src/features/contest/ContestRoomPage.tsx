import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import type { Socket } from 'socket.io-client';
import confetti from 'canvas-confetti';
import axios from 'axios';
import { useAuth } from '../../auth/useAuth';
import { ToastStack } from '../../components/ToastStack';
import { useToasts } from '../../lib/useToasts';
import { createContestSocket } from '../../lib/socket';
import { getApiErrorMessage } from '../../lib/apiError';
import { sfx } from '../../lib/sfx';
import { Icon } from '../../components/ui/Icon';
import { PlayerAvatar } from '../../components/ui/PlayerAvatar';
import { Pips } from '../../components/ui/Pips';
import { ProgressRing } from '../../components/ui/ProgressRing';
import { TierBadge } from '../../components/ui/TierBadge';
import { acceptChallenge, declineChallenge, getContest, submitContestSolution } from './api';
import { CellChip } from './CellChip';
import { cellText } from './cellText';
import type { ContestCellSummary, ContestDetail } from './types';

const DIFFICULTY_STYLE: Record<string, { text: string; border: string; bg: string }> = {
  Easy: { text: 'text-emerald-400', border: 'border-emerald-500/40', bg: 'bg-emerald-500/10' },
  Medium: { text: 'text-amber-400', border: 'border-amber-500/40', bg: 'bg-amber-500/10' },
  Hard: { text: 'text-rose-400', border: 'border-rose-500/40', bg: 'bg-rose-500/10' },
};
const DEFAULT_DIFFICULTY_STYLE = { text: 'text-slate-400', border: 'border-slate-600/40', bg: 'bg-slate-500/10' };

interface LiveResult {
  verdict: string;
  totalPassed: number;
  totalTests: number;
}

function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function verdictTone(verdict: string | undefined | null): { text: string; color: string } {
  if (verdict === 'AC') return { text: 'text-emerald-300', color: '#34d399' };
  if (!verdict || verdict === 'PENDING') return { text: 'text-slate-400', color: '#64748b' };
  return { text: 'text-rose-300', color: '#fb7185' };
}

function FighterCard({
  userId,
  name,
  you,
  result,
  online,
  graceSeconds,
  align,
  cell,
}: {
  userId: string;
  name: string;
  you: boolean;
  result: LiveResult | null;
  online?: boolean;
  graceSeconds?: number | null;
  align: 'left' | 'right';
  /** The cell this player has on the line, if any. */
  cell?: ContestCellSummary | null;
}) {
  const tone = verdictTone(result?.verdict);
  const right = align === 'right';
  return (
    <div className={`hud-panel hud-panel-quiet p-3.5 ${you ? 'ring-1 ring-cyan-400/40' : ''}`}>
      <div className={`flex items-center gap-3 ${right ? 'flex-row-reverse text-right' : ''}`}>
        <PlayerAvatar userId={userId} name={name} size={52} />
        <div className="min-w-0 flex-1">
          <p className="hud-label !text-[0.6rem]" style={{ color: you ? '#67e8f9' : undefined }}>
            {you ? 'You' : 'Opponent'}
          </p>
          <p className="font-display truncate text-xl font-bold leading-tight text-slate-50">{name}</p>
          {cell && <CellChip cell={cell} />}
          {online !== undefined &&
            (online ? (
              <p className="text-[0.68rem] font-bold uppercase tracking-wide text-emerald-400">● online</p>
            ) : (
              <p className="animate-pulse text-[0.68rem] font-bold uppercase tracking-wide text-rose-400">
                ○ disconnected{graceSeconds ? ` · ${graceSeconds}s` : ''}
              </p>
            ))}
        </div>
      </div>
      <div className="mt-3">
        <div className={`mb-1.5 flex items-baseline justify-between ${right ? 'flex-row-reverse' : ''}`}>
          <span className={`font-mono text-sm font-bold ${tone.text}`}>{result?.verdict ?? 'PENDING'}</span>
          <span className="font-mono text-xs font-bold tabular-nums text-slate-400">
            {result ? `${result.totalPassed}/${result.totalTests}` : '—'}
          </span>
        </div>
        <Pips filled={result?.totalPassed ?? 0} total={Math.max(1, Math.min(result?.totalTests || 5, 12))} color={tone.color} />
      </div>
    </div>
  );
}

export default function ContestRoomPage() {
  const { id } = useParams<{ id: string }>();
  const { user, token } = useAuth();
  const navigate = useNavigate();
  const { toasts, push, dismiss } = useToasts();

  const [contest, setContest] = useState<ContestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionBusy, setActionBusy] = useState(false);

  const [language, setLanguage] = useState('python');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const [selfResult, setSelfResult] = useState<LiveResult | null>(null);
  const [opponentResult, setOpponentResult] = useState<LiveResult | null>(null);
  const [opponentConnected, setOpponentConnected] = useState(true);
  const [graceSeconds, setGraceSeconds] = useState<number | null>(null);
  const [ended, setEnded] = useState<{ winnerId: string | null; reason: string } | null>(null);
  const celebratedRef = useRef(false);

  const loadContest = useCallback(async () => {
    if (!id) return;
    try {
      const data = await getContest(id);
      setContest(data);
      setCode((prev) => prev || data.problem.boilerplate[language] || '');

      const self = data.participants.find((p) => p.userId === user?.userId);
      const opponent = data.participants.find((p) => p.userId !== user?.userId);
      if (self) setSelfResult({ verdict: self.verdict ?? 'PENDING', totalPassed: self.totalPassed, totalTests: self.totalTests });
      if (opponent) {
        setOpponentResult({ verdict: opponent.verdict ?? 'PENDING', totalPassed: opponent.totalPassed, totalTests: opponent.totalTests });
        setOpponentConnected(opponent.connected);
      }
      if (data.status === 'COMPLETED' || data.status === 'DECLINED' || data.status === 'EXPIRED' || data.status === 'CANCELLED') {
        setEnded({ winnerId: data.winnerId, reason: data.endReason ?? data.status });
      }
    } catch (err: unknown) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      setLoadError(
        status === 404
          ? 'Contest not found.'
          : status === 403
          ? "You're not part of this contest."
          : 'Failed to load contest.',
      );
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user?.userId]);

  useEffect(() => {
    // Deferred so the effect body itself never calls setState synchronously
    // — loadContest is still the single source of truth for hydrating state.
    const timer = setTimeout(loadContest, 0);
    return () => clearTimeout(timer);
  }, [loadContest]);

  // Poll while PENDING — the other side accepting/declining elsewhere in the
  // app should be reflected here without requiring a live socket.
  useEffect(() => {
    if (!contest || contest.status !== 'PENDING') return;
    const interval = setInterval(loadContest, 3000);
    return () => clearInterval(interval);
  }, [contest, loadContest]);

  // Live match socket — only needed once the contest is actually running.
  useEffect(() => {
    if (!contest || contest.status !== 'ACTIVE' || !token || !id) return;

    const socket: Socket = createContestSocket(token);

    socket.on('connect', () => {
      socket.emit('contest:join', { contestId: id });
      loadContest(); // resync on connect/reconnect (Section 14.4)
    });

    socket.on('contest:opponentStatus', (payload: { userId: string; connected: boolean; graceSeconds?: number }) => {
      if (payload.userId === user?.userId) return;
      setOpponentConnected(payload.connected);
      setGraceSeconds(payload.connected ? null : payload.graceSeconds ?? null);
    });

    socket.on(
      'contest:submissionResult',
      (payload: { userId: string; verdict: string; totalPassed: number; totalTests: number }) => {
        const result: LiveResult = {
          verdict: payload.verdict,
          totalPassed: payload.totalPassed,
          totalTests: payload.totalTests,
        };
        if (payload.userId === user?.userId) {
          setSelfResult(result);
        } else {
          setOpponentResult(result);
          push(`Opponent's submission: ${payload.verdict}`, payload.verdict === 'AC' ? 'warning' : 'info');
        }
      },
    );

    socket.on('contest:ended', (payload: { winnerId: string | null; reason: string }) => {
      setEnded(payload);
      loadContest();
    });

    socket.on('contest:error', (payload: { message: string }) => {
      push(payload.message, 'warning');
    });

    return () => {
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contest?.status, id, token]);

  // Server-authoritative countdown — always re-derived from startedAt +
  // durationSeconds, never an independently drifting local counter.
  useEffect(() => {
    if (!contest?.startedAt || contest.status !== 'ACTIVE') return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [contest?.startedAt, contest?.status]);

  useEffect(() => {
    if (!ended || celebratedRef.current) return;
    celebratedRef.current = true;
    if (ended.winnerId === user?.userId) {
      sfx.play('win');
      confetti({ particleCount: 180, spread: 100, origin: { y: 0.6 } });
    } else if (ended.winnerId) {
      sfx.play('error');
    }
  }, [ended, user?.userId]);

  async function handleAccept() {
    if (!id) return;
    setActionBusy(true);
    try {
      await acceptChallenge(id);
      await loadContest();
    } catch (err: unknown) {
      push(getApiErrorMessage(err, 'Could not accept challenge'), 'warning');
    } finally {
      setActionBusy(false);
    }
  }

  async function handleDecline() {
    if (!id) return;
    setActionBusy(true);
    try {
      await declineChallenge(id);
      navigate('/contests');
    } catch (err: unknown) {
      push(getApiErrorMessage(err, 'Could not decline challenge'), 'warning');
      setActionBusy(false);
    }
  }

  async function handleSubmit() {
    if (!id) return;
    sfx.play('click');
    setSubmitting(true);
    try {
      await submitContestSolution(id, code, language);
      push('Solution submitted — judging…', 'info');
    } catch (err: unknown) {
      push(getApiErrorMessage(err, 'Submission failed'), 'warning');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="hud-grid-bg flex min-h-[calc(100dvh-var(--nav-h))] flex-1 items-center justify-center">
        <div className="relative z-10 flex flex-col items-center gap-4">
          <div className="relative h-14 w-14">
            <div className="hex absolute inset-0 animate-spin-slow bg-gradient-to-b from-orange-400/80 to-rose-600/30" />
            <div className="hex absolute inset-[3px] bg-slate-950" />
            <Icon name="swords" className="absolute inset-0 m-auto h-5 w-5 text-orange-300" />
          </div>
          <p className="font-display text-sm font-bold uppercase tracking-[0.3em] text-orange-300">Entering the arena…</p>
        </div>
      </div>
    );
  }

  if (loadError || !contest) {
    return (
      <div className="hud-grid-bg flex min-h-[calc(100dvh-var(--nav-h))] flex-1 flex-col items-center justify-center gap-4">
        <p className="relative z-10 text-rose-400">{loadError || 'Something went wrong.'}</p>
        <Link to="/contests" className="relative z-10 text-sm text-cyan-400 hover:underline">
          ← Back to Contests
        </Link>
      </div>
    );
  }

  const isChallenger = user?.userId === contest.challenger.id;
  const isDefender = user?.userId === contest.defender.id;
  const self = isChallenger ? contest.challenger : contest.defender;
  const opponent = isChallenger ? contest.defender : contest.challenger;
  const diffStyle = DIFFICULTY_STYLE[contest.problem.difficultyLevel] ?? DEFAULT_DIFFICULTY_STYLE;

  const remainingSeconds = contest.startedAt
    ? Math.max(
        0,
        Math.floor((new Date(contest.startedAt).getTime() + contest.durationSeconds * 1000 - now) / 1000),
      )
    : contest.durationSeconds;
  const timeFrac = contest.durationSeconds > 0 ? remainingSeconds / contest.durationSeconds : 0;
  const timerColor = timeFrac > 0.5 ? '#22d3ee' : timeFrac > 0.2 ? '#fbbf24' : '#fb7185';
  const urgent = remainingSeconds > 0 && remainingSeconds <= 30;
  const won = ended?.winnerId === user?.userId;
  // Each side puts a cell on the line: the challenger their stake, the defender the contested cell.
  // The loser's cell goes to the winner. Duels made before stakes existed have no stake.
  const myCell = isChallenger ? contest.pledgedCell : contest.cell;
  const theirCell = isChallenger ? contest.cell : contest.pledgedCell;
  const winnerName = ended?.winnerId === contest.challenger.id ? contest.challenger.name : contest.defender.name;
  const wonText = isChallenger
    ? `${cellText(contest.cell)} is yours.`
    : theirCell
      ? `You held ${contest.cell.territoryName} and took ${cellText(theirCell)}.`
      : `You held ${contest.cell.territoryName}.`;
  const lostText = myCell ? `You lost this contest. ${cellText(myCell)} goes to ${winnerName}.` : 'You lost this contest. The cell stays with your rival.';

  return (
    <div className="hud-grid-bg min-h-[calc(100dvh-var(--nav-h))] flex-1">
      <div className="relative z-10 mx-auto max-w-[88rem] px-4 py-5 text-left md:px-8 md:py-8">
        <ToastStack toasts={toasts} dismiss={dismiss} placement="top-right" />

        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Link to="/contests" className="group inline-flex items-center gap-2 text-sm font-semibold text-slate-400 transition-colors hover:text-cyan-300">
            <Icon name="arrowLeft" className="h-4 w-4 transition-transform group-hover:-translate-x-1" /> All duels
          </Link>
          <div className="flex items-center gap-3">
            <TierBadge tier={contest.cell.tier} size="md" />
            <h1 className="font-display text-2xl font-bold tracking-wide text-slate-50 sm:text-3xl">{contest.cell.territoryName}</h1>
          </div>
          <span
            className={`rounded-full border px-3 py-1 font-display text-xs font-bold uppercase tracking-[0.16em] ${
              ended
                ? 'border-slate-600 text-slate-400'
                : contest.status === 'ACTIVE'
                  ? 'border-rose-400/60 bg-rose-500/10 text-rose-300'
                  : 'border-amber-400/50 bg-amber-400/10 text-amber-300'
            }`}
          >
            {ended ? 'Finished' : contest.status === 'ACTIVE' ? '● Live' : 'Awaiting response'}
          </span>
        </div>

        {contest.status === 'PENDING' && (
          <div className="hud-panel relative overflow-hidden p-6 text-center md:p-10 animate-fade-in-up">
            <div className="pointer-events-none absolute left-1/2 top-0 h-48 w-96 -translate-x-1/2 rounded-full bg-orange-500/10 blur-3xl" />
            <div className="relative mx-auto grid max-w-xl grid-cols-[1fr_auto_1fr] items-center gap-4">
              <div className="flex flex-col items-center gap-2">
                <PlayerAvatar userId={contest.challenger.id} name={contest.challenger.name} size={76} />
                <p className="font-display text-xl font-bold text-rose-300">{contest.challenger.name}</p>
                <p className="hud-label !text-[0.58rem]">Challenger</p>
                {contest.pledgedCell && <CellChip cell={contest.pledgedCell} />}
              </div>
              <span className="font-display flex h-14 w-14 items-center justify-center rounded-full border border-orange-400/60 bg-orange-500/10 text-xl font-bold text-orange-300 animate-glow-pulse">
                VS
              </span>
              <div className="flex flex-col items-center gap-2">
                <PlayerAvatar userId={contest.defender.id} name={contest.defender.name} size={76} />
                <p className="font-display text-xl font-bold text-cyan-300">{contest.defender.name}</p>
                <p className="hud-label !text-[0.58rem]">Defender</p>
                <CellChip cell={contest.cell} />
              </div>
            </div>
            <p className={`relative mt-6 inline-block rounded-md border px-3 py-1 text-sm font-semibold ${diffStyle.border} ${diffStyle.bg} ${diffStyle.text}`}>
              {contest.problem.title} · {contest.problem.difficultyLevel} · {Math.round(contest.durationSeconds / 60)} min
            </p>
            {contest.pledgedCell && (
              <p className="relative mt-3 text-sm text-slate-400">
                {isDefender
                  ? `Win and you take ${cellText(contest.pledgedCell)}. Lose and ${cellText(contest.cell)} goes to ${contest.challenger.name}.`
                  : `Win and you take ${cellText(contest.cell)}. Lose and ${cellText(contest.pledgedCell)} goes to ${contest.defender.name}.`}
              </p>
            )}
            {isDefender ? (
              <div className="relative mt-7 flex justify-center gap-3">
                <button onClick={handleAccept} disabled={actionBusy} className="btn-primary h-12 rounded-lg px-8 text-sm">
                  <Icon name="swords" className="h-4 w-4" />
                  {actionBusy ? 'Accepting…' : 'Accept challenge'}
                </button>
                <button onClick={handleDecline} disabled={actionBusy} className="btn-ghost h-12 rounded-lg px-6 text-sm font-semibold">
                  Decline
                </button>
              </div>
            ) : (
              <p className="relative mt-7 animate-pulse text-sm font-semibold text-amber-300">Waiting for {contest.defender.name} to respond…</p>
            )}
          </div>
        )}

        {ended && (
          <div
            className={`hud-panel relative mb-6 overflow-hidden p-6 text-center md:p-8 animate-pop-in ${
              won ? 'bg-gradient-to-br from-emerald-950/80 to-slate-950/80' : ended.winnerId ? 'bg-gradient-to-br from-rose-950/60 to-slate-950/80' : ''
            }`}
            style={{
              borderColor: won ? 'rgba(52,211,153,0.55)' : ended.winnerId ? 'rgba(251,113,133,0.5)' : undefined,
              boxShadow: won ? '0 0 50px -14px rgba(16,185,129,0.65)' : ended.winnerId ? '0 0 50px -16px rgba(244,63,94,0.5)' : undefined,
            }}
          >
            <div
              className={`mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full border ${
                won ? 'border-emerald-400/60 bg-emerald-400/15 text-emerald-300' : ended.winnerId ? 'border-rose-400/60 bg-rose-400/15 text-rose-300' : 'border-slate-500 bg-slate-500/10 text-slate-300'
              } ${won ? 'animate-float' : ''}`}
            >
              <Icon name={won ? 'flag' : ended.winnerId ? 'skull' : 'swords'} filled={won} className="h-8 w-8" />
            </div>
            <p className={`font-display text-4xl font-bold uppercase tracking-[0.12em] ${won ? 'text-emerald-300' : ended.winnerId ? 'text-rose-300' : 'text-slate-200'}`}>
              {won ? (isChallenger ? 'Territory captured!' : 'Cell defended!') : ended.winnerId ? 'Defeat' : 'Stalemate'}
            </p>
            <p className="mt-1 text-sm text-slate-300">{won ? wonText : ended.winnerId ? lostText : 'Draw — no territory changed hands.'}</p>
            <p className="hud-label mt-2 !text-[0.64rem]">
              {ended.reason === 'AC' && 'Decided by first accepted solution'}
              {ended.reason === 'TIMEOUT' && 'Decided on test cases passed when time ran out'}
              {ended.reason === 'FORFEIT' && 'Decided by opponent disconnect'}
              {ended.reason === 'DRAW' && 'Equal test cases passed'}
            </p>
            <div className="mt-5 flex justify-center gap-3">
              <Link to="/map" className="btn-primary h-11 rounded-lg px-6 text-sm">
                <Icon name="map" className="h-4 w-4" /> View the map
              </Link>
              <Link to="/contests" className="btn-ghost h-11 rounded-lg px-5 text-sm font-semibold">
                All duels
              </Link>
            </div>
          </div>
        )}

        {contest.status === 'ACTIVE' && !ended && (
          <>
            <div className="mb-5 grid items-stretch gap-3 md:grid-cols-[1fr_auto_1fr] animate-fade-in-up">
              <FighterCard userId={self.id} name={self.name} you result={selfResult} align="left" cell={myCell} />

              <div className="hud-panel flex flex-col items-center justify-center px-6 py-3" style={urgent ? { borderColor: 'rgba(251,113,133,0.7)', boxShadow: '0 0 36px -10px rgba(244,63,94,0.7)' } : undefined}>
                <ProgressRing pct={timeFrac} size={118} stroke={7} color={timerColor} track="rgba(51,65,85,0.5)">
                  <span className={`font-mono text-3xl font-bold tabular-nums ${urgent ? 'animate-pulse text-rose-300' : 'text-slate-50'}`}>{formatClock(remainingSeconds)}</span>
                </ProgressRing>
                <p className="hud-label mt-1 !text-[0.6rem]">{remainingSeconds === 0 ? 'Time’s up' : 'Time left'}</p>
              </div>

              <FighterCard
                userId={opponent.id}
                name={opponent.name}
                you={false}
                result={opponentResult}
                online={opponentConnected}
                graceSeconds={graceSeconds}
                align="right"
                cell={theirCell}
              />
            </div>

            <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
              <section className="hud-panel p-5 md:p-6 animate-fade-in-up">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-display text-2xl font-bold tracking-wide text-slate-50">{contest.problem.title}</h2>
                  <span className={`rounded-md border px-2 py-0.5 font-display text-xs font-bold uppercase tracking-[0.12em] ${diffStyle.border} ${diffStyle.bg} ${diffStyle.text}`}>
                    {contest.problem.difficultyLevel}
                  </span>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-[0.92rem] leading-relaxed text-slate-300">{contest.problem.description}</p>
                <h3 className="hud-label mb-2 mt-5 text-cyan-300">Examples</h3>
                <div className="space-y-2">
                  {contest.problem.examples.map((ex, i) => (
                    <div key={i} className="overflow-hidden rounded-lg border border-slate-700/70 bg-black/40 text-sm">
                      <div className="grid grid-cols-[4.5rem_1fr] border-b border-slate-800">
                        <span className="hud-label !text-[0.62rem] px-3 py-2 text-slate-500">Input</span>
                        <span className="block overflow-x-auto py-2 pr-3 font-mono text-[0.82rem] text-slate-200">{JSON.stringify(ex.input)}</span>
                      </div>
                      <div className="grid grid-cols-[4.5rem_1fr]">
                        <span className="hud-label !text-[0.62rem] px-3 py-2 text-slate-500">Output</span>
                        <span className="block overflow-x-auto py-2 pr-3 font-mono text-[0.82rem] text-emerald-300">{JSON.stringify(ex.output)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="hud-panel p-4 md:p-5 animate-fade-in-up lg:sticky lg:top-[calc(var(--nav-h)+1rem)]" style={{ animationDelay: '80ms' }}>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-display text-sm font-bold uppercase tracking-[0.18em] text-slate-100">Your solution</h3>
                  <div className="flex rounded-lg border border-slate-700 bg-slate-950/60 p-0.5" role="tablist" aria-label="Language">
                    {(['python', 'c++'] as const).map((lang) => (
                      <button
                        key={lang}
                        role="tab"
                        aria-selected={language === lang}
                        onClick={() => {
                          setLanguage(lang);
                          setCode(contest.problem.boilerplate[lang] || '');
                        }}
                        className={`rounded-md px-3.5 py-1 text-xs font-bold transition-all ${
                          language === lang ? 'bg-cyan-400/20 text-cyan-200 shadow-[0_0_12px_-3px_rgba(34,211,238,0.7)]' : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {lang === 'python' ? 'Python' : 'C++'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="overflow-hidden rounded-lg border border-slate-700/80 shadow-[0_0_30px_-14px_rgba(34,211,238,0.5)]">
                  <Editor
                    height="380px"
                    language={language === 'c++' ? 'cpp' : language}
                    value={code}
                    onChange={(value) => setCode(value || '')}
                    theme="vs-dark"
                    options={{ fontSize: 14, minimap: { enabled: false }, scrollBeyondLastLine: false, padding: { top: 12 } }}
                  />
                </div>
                <button onClick={handleSubmit} disabled={submitting || remainingSeconds === 0} className="btn-primary mt-4 h-11 rounded-lg px-6 text-sm">
                  <Icon name="rocket" className="h-4 w-4" />
                  {submitting ? 'Deploying…' : remainingSeconds === 0 ? 'Time expired' : 'Submit solution'}
                </button>
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
