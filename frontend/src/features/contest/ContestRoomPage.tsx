import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import type { Socket } from 'socket.io-client';
import confetti from 'canvas-confetti';
import axios from 'axios';
import { useAuth } from '../../auth/AuthContext';
import { ToastStack } from '../../components/ToastStack';
import { useToasts } from '../../lib/useToasts';
import { createContestSocket } from '../../lib/socket';
import { getApiErrorMessage } from '../../lib/apiError';
import { acceptChallenge, declineChallenge, getContest, submitContestSolution } from './api';
import type { ContestDetail } from './types';

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

function verdictColor(verdict: string | undefined | null): string {
  if (verdict === 'AC') return 'text-emerald-400';
  if (!verdict || verdict === 'PENDING') return 'text-slate-500';
  return 'text-rose-400';
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
    if (ended && ended.winnerId === user?.userId && !celebratedRef.current) {
      celebratedRef.current = true;
      confetti({ particleCount: 180, spread: 100, origin: { y: 0.6 } });
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
      <div className="min-h-screen hud-grid-bg flex items-center justify-center">
        <p className="text-slate-400 animate-pulse">Entering the arena…</p>
      </div>
    );
  }

  if (loadError || !contest) {
    return (
      <div className="min-h-screen hud-grid-bg flex flex-col items-center justify-center gap-4">
        <p className="text-rose-400">{loadError || 'Something went wrong.'}</p>
        <Link to="/contests" className="text-cyan-400 text-sm hover:underline">
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

  return (
    <div className="min-h-screen hud-grid-bg">
      <div className="max-w-5xl mx-auto p-6 md:p-10 text-left">
        <ToastStack toasts={toasts} dismiss={dismiss} />

        <div className="flex items-center justify-between mb-6">
          <h1
            className="text-2xl sm:text-3xl tracking-wide"
            style={{ color: '#f1f5f9', fontFamily: "'Rajdhani', sans-serif", fontWeight: 700 }}
          >
            ⚔️ {contest.cell.territoryName}
          </h1>
          <Link to="/contests" className="text-xs text-slate-400 hover:text-slate-200 transition-colors">
            ← All contests
          </Link>
        </div>

        {contest.status === 'PENDING' && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 backdrop-blur p-8 text-center animate-fade-in-up">
            <p className="text-slate-300 mb-1">
              <span className="text-rose-400 font-semibold">{contest.challenger.name}</span> challenges{' '}
              <span className="text-cyan-300 font-semibold">{contest.defender.name}</span> for this cell
            </p>
            <p className={`inline-block px-2 py-0.5 rounded text-xs border mt-2 ${diffStyle.border} ${diffStyle.bg} ${diffStyle.text}`}>
              {contest.problem.title} · {contest.problem.difficultyLevel}
            </p>
            {isDefender ? (
              <div className="flex justify-center gap-3 mt-6">
                <button
                  onClick={handleAccept}
                  disabled={actionBusy}
                  className="px-5 py-2.5 rounded-lg bg-gradient-to-r from-cyan-500 to-teal-600 text-slate-950 text-sm font-bold disabled:opacity-50 hover:scale-[1.02] active:scale-[0.98] transition-transform"
                >
                  {actionBusy ? 'Accepting…' : 'Accept Challenge'}
                </button>
                <button
                  onClick={handleDecline}
                  disabled={actionBusy}
                  className="px-5 py-2.5 rounded-lg border border-slate-700 text-slate-400 text-sm font-medium hover:text-slate-200 hover:border-slate-500 disabled:opacity-50 transition-colors"
                >
                  Decline
                </button>
              </div>
            ) : (
              <p className="text-amber-400 animate-pulse mt-6 text-sm">
                Waiting for {contest.defender.name} to respond…
              </p>
            )}
          </div>
        )}

        {ended && (
          <div
            className={`rounded-2xl border p-6 mb-6 text-center animate-pop-in ${
              ended.winnerId === user?.userId
                ? 'border-emerald-500/40 bg-gradient-to-br from-emerald-950 to-slate-900 shadow-[0_0_30px_-10px_rgba(16,185,129,0.5)]'
                : ended.winnerId
                ? 'border-rose-500/40 bg-rose-950/20'
                : 'border-slate-700 bg-slate-900/60'
            }`}
          >
            {ended.winnerId === user?.userId && (
              <p className="text-xl font-bold text-emerald-400">🚩 You captured the territory!</p>
            )}
            {ended.winnerId && ended.winnerId !== user?.userId && (
              <p className="text-xl font-bold text-rose-400">💀 You lost this contest.</p>
            )}
            {!ended.winnerId && (
              <p className="text-xl font-bold text-slate-300">🤝 Draw — no territory changed hands.</p>
            )}
            <p className="text-xs text-slate-500 uppercase tracking-wide mt-1">
              {ended.reason === 'AC' && 'Decided by first accepted solution'}
              {ended.reason === 'TIMEOUT' && 'Decided on test cases passed when time ran out'}
              {ended.reason === 'FORFEIT' && 'Decided by opponent disconnect'}
              {ended.reason === 'DRAW' && 'Equal test cases passed'}
            </p>
            <Link to="/map" className="inline-block mt-4 text-cyan-400 text-sm hover:underline">
              View the map →
            </Link>
          </div>
        )}

        {contest.status === 'ACTIVE' && !ended && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6 animate-fade-in-up">
              <div className="flex items-center gap-3">
                <div className="text-sm">
                  <span className="text-slate-500 uppercase tracking-wide text-[10px] block">You</span>
                  <span className="text-slate-100 font-medium">{self.name}</span>
                  <span className={`ml-2 font-mono text-xs ${verdictColor(selfResult?.verdict)}`}>
                    {selfResult?.verdict ?? 'PENDING'} {selfResult ? `(${selfResult.totalPassed}/${selfResult.totalTests})` : ''}
                  </span>
                </div>
              </div>

              <div className="text-3xl font-mono font-bold text-cyan-400 tabular-nums">
                {formatClock(remainingSeconds)}
              </div>

              <div className="text-sm text-right">
                <span className="text-slate-500 uppercase tracking-wide text-[10px] block">Opponent</span>
                <span className="text-slate-100 font-medium">
                  {opponent.name}{' '}
                  {opponentConnected ? (
                    <span className="text-emerald-400 text-xs">● online</span>
                  ) : (
                    <span className="text-rose-400 text-xs animate-pulse">
                      ○ disconnected{graceSeconds ? ` (${graceSeconds}s to reconnect)` : ''}
                    </span>
                  )}
                </span>
                <span className={`ml-2 font-mono text-xs ${verdictColor(opponentResult?.verdict)}`}>
                  {opponentResult?.verdict ?? 'PENDING'}{' '}
                  {opponentResult ? `(${opponentResult.totalPassed}/${opponentResult.totalTests})` : ''}
                </span>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 backdrop-blur p-6 mb-6 animate-fade-in-up">
              <div className="flex items-center gap-2 mb-2">
                <h2 className="text-2xl tracking-wide font-bold text-slate-100" style={{ fontFamily: "'Rajdhani', sans-serif" }}>
                  {contest.problem.title}
                </h2>
                <span className={`px-2 py-0.5 rounded text-xs border ${diffStyle.border} ${diffStyle.bg} ${diffStyle.text} uppercase tracking-wide font-semibold`}>
                  {contest.problem.difficultyLevel}
                </span>
              </div>
              <p className="mb-4 whitespace-pre-wrap text-slate-300 text-sm leading-relaxed">
                {contest.problem.description}
              </p>
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-[0.15em] mb-2">Examples</h3>
              {contest.problem.examples.map((ex, i) => (
                <pre key={i} className="bg-black/40 border border-slate-800 rounded-lg p-3 mb-2 text-sm overflow-x-auto text-slate-300 font-mono">
{`Input: ${JSON.stringify(ex.input)}\nOutput: ${JSON.stringify(ex.output)}`}
                </pre>
              ))}
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 backdrop-blur p-6 animate-fade-in-up">
              <div className="flex items-center gap-2 mb-3">
                {(['python', 'c++'] as const).map((lang) => (
                  <button
                    key={lang}
                    onClick={() => {
                      setLanguage(lang);
                      setCode(contest.problem.boilerplate[lang] || '');
                    }}
                    className={`px-3 py-1 rounded text-xs font-medium border transition-colors ${
                      language === lang
                        ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300'
                        : 'border-slate-700 text-slate-400 hover:border-slate-500'
                    }`}
                  >
                    {lang === 'python' ? 'Python' : 'C++'}
                  </button>
                ))}
              </div>
              <div className="border border-slate-800 rounded-lg overflow-hidden mb-4 shadow-lg">
                <Editor
                  height="320px"
                  language={language === 'c++' ? 'cpp' : language}
                  value={code}
                  onChange={(value) => setCode(value || '')}
                  theme="vs-dark"
                  options={{ fontSize: 14, minimap: { enabled: false } }}
                />
              </div>
              <button
                onClick={handleSubmit}
                disabled={submitting || remainingSeconds === 0}
                className="px-5 py-2.5 rounded-lg bg-gradient-to-r from-cyan-500 to-teal-600 text-slate-950 text-sm font-bold disabled:opacity-50 hover:scale-[1.02] active:scale-[0.98] transition-transform shadow-lg shadow-cyan-900/30"
              >
                {submitting ? 'Deploying…' : remainingSeconds === 0 ? 'Time expired' : '🚀 Submit Solution'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
