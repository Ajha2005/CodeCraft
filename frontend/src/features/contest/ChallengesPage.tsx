import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { ToastStack } from '../../components/ToastStack';
import { useToasts } from '../../lib/useToasts';
import { getApiErrorMessage } from '../../lib/apiError';
import {
  acceptChallenge,
  declineChallenge,
  listActiveContests,
  listIncomingChallenges,
  listOutgoingChallenges,
} from './api';
import type { ContestSummary } from './types';

const POLL_MS = 5000;

const TIER_STYLE: Record<string, { bg: string; text: string; border: string }> = {
  OUTPOST: { bg: 'bg-slate-500/10', text: 'text-slate-300', border: 'border-slate-500/40' },
  SETTLEMENT: { bg: 'bg-emerald-500/10', text: 'text-emerald-300', border: 'border-emerald-500/40' },
  STRONGHOLD: { bg: 'bg-amber-500/10', text: 'text-amber-300', border: 'border-amber-500/40' },
  CITADEL: { bg: 'bg-fuchsia-500/10', text: 'text-fuchsia-300', border: 'border-fuchsia-500/40' },
};
const DEFAULT_TIER_STYLE = { bg: 'bg-slate-500/10', text: 'text-slate-300', border: 'border-slate-500/40' };

function TierBadge({ tier }: { tier: string }) {
  const style = TIER_STYLE[tier] ?? DEFAULT_TIER_STYLE;
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] border ${style.border} ${style.bg} ${style.text} uppercase tracking-wide font-semibold`}>
      {tier}
    </span>
  );
}

export default function ChallengesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toasts, push, dismiss } = useToasts();

  const [incoming, setIncoming] = useState<ContestSummary[]>([]);
  const [outgoing, setOutgoing] = useState<ContestSummary[]>([]);
  const [active, setActive] = useState<ContestSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [inc, out, act] = await Promise.all([
        listIncomingChallenges(),
        listOutgoingChallenges(),
        listActiveContests(),
      ]);
      setIncoming(inc);
      setOutgoing(out);
      setActive(act.filter((c) => c.status === 'ACTIVE'));
    } catch {
      // transient — next poll will retry
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    // Deferred rather than called inline: the initial load shares the same
    // path as the poll interval below, so it's scheduled the same way
    // instead of synchronously setting state during the effect itself.
    const initial = setTimeout(refresh, 0);
    const interval = setInterval(refresh, POLL_MS);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [user, refresh]);

  async function handleAccept(id: string) {
    setBusyId(id);
    try {
      await acceptChallenge(id);
      navigate(`/contest/${id}`);
    } catch (err: unknown) {
      push(getApiErrorMessage(err, 'Could not accept challenge'), 'warning');
      setBusyId(null);
      refresh();
    }
  }

  async function handleDecline(id: string) {
    setBusyId(id);
    try {
      await declineChallenge(id);
      push('Challenge declined.', 'info');
      refresh();
    } catch (err: unknown) {
      push(getApiErrorMessage(err, 'Could not decline challenge'), 'warning');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="min-h-screen hud-grid-bg">
      <div className="max-w-4xl mx-auto p-6 md:p-10 text-left">
        <ToastStack toasts={toasts} dismiss={dismiss} />

        <h1
          className="text-4xl sm:text-5xl tracking-wide mb-8"
          style={{ color: '#f1f5f9', fontFamily: "'Rajdhani', sans-serif", fontWeight: 700 }}
        >
          ⚔️ Contests
        </h1>

        {loading && <p className="text-slate-500 text-sm mb-6">Loading…</p>}

        {active.length > 0 && (
          <section className="mb-10 animate-fade-in-up">
            <h2 className="text-sm font-bold text-slate-400 uppercase tracking-[0.15em] mb-3">
              In progress
            </h2>
            <div className="grid gap-3">
              {active.map((c) => (
                <button
                  key={c.id}
                  onClick={() => navigate(`/contest/${c.id}`)}
                  className="text-left rounded-xl border border-cyan-600/40 bg-cyan-950/20 hover:bg-cyan-950/40 p-4 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-slate-100 font-medium text-sm">
                        {c.challenger.name} vs {c.defender.name}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {c.cell.territoryName} · {c.problem.title}
                      </p>
                    </div>
                    <span className="text-cyan-400 text-xs font-semibold uppercase tracking-wide animate-pulse">
                      Live — rejoin →
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="mb-10 animate-fade-in-up">
          <h2 className="text-sm font-bold text-slate-400 uppercase tracking-[0.15em] mb-3">
            Incoming challenges {incoming.length > 0 && `(${incoming.length})`}
          </h2>
          {incoming.length === 0 ? (
            <p className="text-slate-500 italic text-sm">
              No one's come for your territory yet.
            </p>
          ) : (
            <div className="grid gap-3">
              {incoming.map((c) => (
                <div
                  key={c.id}
                  className="rounded-xl border border-slate-800 bg-slate-900/60 backdrop-blur p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-slate-100 font-medium text-sm">
                        <span className="text-rose-400">{c.challenger.name}</span> wants to fight you for{' '}
                        <span className="text-cyan-300">{c.cell.territoryName}</span>
                      </p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <TierBadge tier={c.cell.tier} />
                        <span className="text-xs text-slate-400">
                          {c.problem.title} ({c.problem.difficultyLevel})
                        </span>
                        <span className="text-xs text-slate-500">
                          · {Math.round(c.durationSeconds / 60)} min
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        disabled={busyId === c.id}
                        onClick={() => handleAccept(c.id)}
                        className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-teal-600 text-slate-950 text-xs font-bold disabled:opacity-50 hover:scale-[1.02] active:scale-[0.98] transition-transform"
                      >
                        {busyId === c.id ? 'Accepting…' : 'Accept'}
                      </button>
                      <button
                        disabled={busyId === c.id}
                        onClick={() => handleDecline(c.id)}
                        className="px-3 py-1.5 rounded-lg border border-slate-700 text-slate-400 text-xs font-medium hover:text-slate-200 hover:border-slate-500 disabled:opacity-50 transition-colors"
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="animate-fade-in-up">
          <h2 className="text-sm font-bold text-slate-400 uppercase tracking-[0.15em] mb-3">
            Outgoing challenges
          </h2>
          {outgoing.length === 0 ? (
            <p className="text-slate-500 italic text-sm">
              No pending challenges sent. Find an enemy-held cell on the map to start one.
            </p>
          ) : (
            <div className="grid gap-3">
              {outgoing.map((c) => (
                <div
                  key={c.id}
                  className="rounded-xl border border-slate-800 bg-slate-900/40 backdrop-blur p-4"
                >
                  <p className="text-slate-100 font-medium text-sm">
                    Waiting on <span className="text-amber-400">{c.defender.name}</span> for{' '}
                    <span className="text-cyan-300">{c.cell.territoryName}</span>
                  </p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <TierBadge tier={c.cell.tier} />
                    <span className="text-xs text-slate-400">
                      {c.problem.title} ({c.problem.difficultyLevel})
                    </span>
                    <span className="text-xs text-amber-400/80 animate-pulse">· pending response</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
