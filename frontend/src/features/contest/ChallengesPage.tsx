import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { ToastStack } from '../../components/ToastStack';
import { useToasts } from '../../lib/useToasts';
import { getApiErrorMessage } from '../../lib/apiError';
import { sfx } from '../../lib/sfx';
import { Icon } from '../../components/ui/Icon';
import { PlayerAvatar } from '../../components/ui/PlayerAvatar';
import { SectionTitle } from '../../components/ui/SectionTitle';
import { TierBadge } from '../../components/ui/TierBadge';
import {
  acceptChallenge,
  declineChallenge,
  listActiveContests,
  listIncomingChallenges,
  listOutgoingChallenges,
} from './api';
import type { ContestSummary } from './types';

const POLL_MS = 5000;

const DIFFICULTY_TEXT: Record<string, string> = {
  Easy: 'text-emerald-400',
  Medium: 'text-amber-400',
  Hard: 'text-rose-400',
};

/** Two fighters facing off. `you` marks which side is the current player. */
function Versus({ left, right, you }: { left: { id: string; name: string }; right: { id: string; name: string }; you: string | undefined }) {
  const side = (p: { id: string; name: string }, align: 'left' | 'right') => (
    <div className={`flex min-w-0 items-center gap-3 ${align === 'right' ? 'flex-row-reverse text-right' : ''}`}>
      <PlayerAvatar userId={p.id} name={p.name} size={44} />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-50">{p.name}</p>
        {p.id === you && <p className="hud-label !text-[0.58rem] !text-cyan-300">You</p>}
      </div>
    </div>
  );
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
      {side(left, 'left')}
      <span className="font-display flex h-9 w-9 items-center justify-center rounded-full border border-orange-400/50 bg-orange-500/10 text-sm font-bold text-orange-300">VS</span>
      {side(right, 'right')}
    </div>
  );
}

function EmptyState({ icon, title, hint, action }: { icon: 'swords' | 'flag' | 'bell'; title: string; hint?: string; action?: { to: string; label: string } }) {
  return (
    <div className="hud-panel hud-panel-quiet flex flex-col items-center px-6 py-8 text-center">
      <div className="relative mb-3 flex h-14 w-14 items-center justify-center">
        <div className="hex absolute inset-0 bg-slate-700/60" />
        <div className="hex absolute inset-[2px] bg-slate-950" />
        <Icon name={icon} className="relative h-6 w-6 text-slate-500" />
      </div>
      <p className="text-sm italic text-slate-400">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-xs text-slate-500">{hint}</p>}
      {action && (
        <Link to={action.to} className="btn-ghost mt-4 h-9 rounded-lg px-4 text-xs font-bold uppercase tracking-wide">
          {action.label}
        </Link>
      )}
    </div>
  );
}

export default function ChallengesPage() {
  const { user, flavorTextEnabled } = useAuth();
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
      sfx.play('win');
      navigate(`/contest/${id}`);
    } catch (err: unknown) {
      sfx.play('error');
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
    <div className="hud-grid-bg min-h-[calc(100dvh-var(--nav-h))] flex-1">
      <div className="relative z-10 mx-auto max-w-4xl px-4 py-6 text-left md:px-8 md:py-10">
        <ToastStack toasts={toasts} dismiss={dismiss} placement="top-right" />

        <header className="hud-panel relative mb-8 overflow-hidden p-5 md:p-7 animate-fade-in-up">
          <div className="pointer-events-none absolute -right-10 -top-16 h-56 w-56 rounded-full bg-orange-500/10 blur-3xl" />
          <div className="relative flex flex-wrap items-center justify-between gap-5">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-orange-400/50 bg-orange-500/10 text-orange-300 shadow-[0_0_28px_-6px_rgba(249,115,22,0.7)]">
                <Icon name="swords" className="h-7 w-7" />
              </div>
              <div>
                <p className="hud-label text-orange-300">{flavorTextEnabled ? 'The arena' : 'Contests'}</p>
                <h1 className="font-display text-4xl font-bold leading-none tracking-wide text-slate-50 sm:text-5xl">Duels</h1>
                <p className="mt-1.5 max-w-md text-sm text-slate-400">Win a live 1v1 and the cell changes hands, instantly.</p>
              </div>
            </div>
            <div className="flex gap-2.5">
              {[
                { label: 'Live', n: active.length, color: '#22d3ee' },
                { label: 'Incoming', n: incoming.length, color: '#fb7185' },
                { label: 'Sent', n: outgoing.length, color: '#fbbf24' },
              ].map((s) => (
                <div key={s.label} className="min-w-[4.6rem] rounded-xl border border-slate-700/70 bg-slate-950/50 px-3 py-2 text-center">
                  <p className="font-mono text-2xl font-bold tabular-nums" style={{ color: s.n > 0 ? s.color : '#475569' }}>
                    {s.n}
                  </p>
                  <p className="hud-label !text-[0.58rem]">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        </header>

        {loading && <p className="mb-6 animate-pulse text-sm text-slate-500">Scanning the arena…</p>}

        {active.length > 0 && (
          <section className="mb-9 animate-fade-in-up">
            <SectionTitle icon="zap">In progress</SectionTitle>
            <div className="grid gap-3">
              {active.map((c) => (
                <button
                  key={c.id}
                  onClick={() => navigate(`/contest/${c.id}`)}
                  className="group hud-panel relative overflow-hidden p-4 text-left transition-all hover:-translate-y-0.5"
                  style={{ borderColor: 'rgba(34,211,238,0.5)', boxShadow: '0 0 34px -14px rgba(34,211,238,0.6)' }}
                >
                  <div className="mb-3 flex items-center justify-between">
                    <span className="flex items-center gap-2 text-[0.7rem] font-bold uppercase tracking-[0.18em] text-rose-300">
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-75" style={{ animation: 'ping-ring 1.2s ease-out infinite' }} />
                        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" />
                      </span>
                      Live
                    </span>
                    <span className="flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-cyan-300 transition-transform group-hover:translate-x-1">
                      Rejoin <Icon name="arrowRight" className="h-3.5 w-3.5" />
                    </span>
                  </div>
                  <Versus left={c.challenger} right={c.defender} you={user?.userId} />
                  <p className="mt-3 flex flex-wrap items-center gap-x-2 text-xs text-slate-400">
                    <span className="font-semibold text-slate-200">{c.cell.territoryName}</span>
                    <TierBadge tier={c.cell.tier} />
                    <span>· {c.problem.title}</span>
                  </p>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="mb-9 animate-fade-in-up">
          <SectionTitle
            icon="bell"
            aside={incoming.length > 0 ? <span className="rounded-full bg-rose-500 px-2 py-0.5 font-mono text-xs font-bold text-white">{incoming.length}</span> : undefined}
          >
            Incoming challenges
          </SectionTitle>
          {incoming.length === 0 ? (
            <EmptyState icon="bell" title="No one’s come for your territory yet." hint="When a rival challenges one of your cells, the invite lands here." />
          ) : (
            <div className="grid gap-3">
              {incoming.map((c, i) => (
                <div
                  key={c.id}
                  className="hud-panel relative overflow-hidden p-4 animate-fade-in-up"
                  style={{ animationDelay: `${i * 70}ms`, borderColor: 'rgba(251,113,133,0.45)', boxShadow: '0 0 34px -16px rgba(244,63,94,0.55)' }}
                >
                  <span className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-rose-400 to-orange-400" />
                  <div className="flex flex-wrap items-center justify-between gap-4 pl-2">
                    <div className="min-w-0 flex-1">
                      <Versus left={c.challenger} right={c.defender} you={user?.userId} />
                      <p className="mt-3 text-sm text-slate-300">
                        <span className="font-semibold text-rose-300">{c.challenger.name}</span> wants to fight you for{' '}
                        <span className="font-semibold text-cyan-300">{c.cell.territoryName}</span>
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                        <TierBadge tier={c.cell.tier} />
                        <span>
                          {c.problem.title}{' '}
                          <span className={`font-semibold ${DIFFICULTY_TEXT[c.problem.difficultyLevel] ?? ''}`}>({c.problem.difficultyLevel})</span>
                        </span>
                        <span className="inline-flex items-center gap-1 text-slate-500">
                          <Icon name="clock" className="h-3 w-3" />
                          {Math.round(c.durationSeconds / 60)} min
                        </span>
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button disabled={busyId === c.id} onClick={() => handleAccept(c.id)} className="btn-primary h-10 rounded-lg px-5 text-sm">
                        <Icon name="swords" className="h-4 w-4" />
                        {busyId === c.id ? 'Accepting…' : 'Accept'}
                      </button>
                      <button disabled={busyId === c.id} onClick={() => handleDecline(c.id)} className="btn-ghost h-10 rounded-lg px-4 text-sm font-semibold">
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
          <SectionTitle icon="flag">Outgoing challenges</SectionTitle>
          {outgoing.length === 0 ? (
            <EmptyState
              icon="swords"
              title="No pending challenges sent."
              hint="Find a rival-held cell on the map and challenge its owner."
              action={{ to: '/map', label: 'Open the map' }}
            />
          ) : (
            <div className="grid gap-3">
              {outgoing.map((c) => (
                <div key={c.id} className="hud-panel hud-panel-quiet p-4">
                  <Versus left={c.challenger} right={c.defender} you={user?.userId} />
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <span className="font-semibold text-slate-200">{c.cell.territoryName}</span>
                    <TierBadge tier={c.cell.tier} />
                    <span>
                      · {c.problem.title} ({c.problem.difficultyLevel})
                    </span>
                    <span className="ml-auto flex items-center gap-1.5 font-semibold text-amber-300/90">
                      Waiting on {c.defender.name}
                      <span className="flex gap-0.5">
                        {[0, 1, 2].map((d) => (
                          <span key={d} className="h-1 w-1 rounded-full bg-amber-300" style={{ animation: `blink-soft 1.2s ${d * 0.2}s ease-in-out infinite` }} />
                        ))}
                      </span>
                    </span>
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
