import { useEffect, useRef, useState, type RefObject } from 'react';
import { useAuth } from '../../auth/useAuth';
import { AnimatedNumber } from '../../components/ui/AnimatedNumber';
import { Icon } from '../../components/ui/Icon';
import { PlayerAvatar } from '../../components/ui/PlayerAvatar';
import { fetchNearMiss, type NearMiss } from '../../api/client';
import { EMPTY_LEADERBOARD } from '../../lib/flavorText';
import { usePlayerStats } from '../../lib/playerStatsContext';
import { useFlipList } from '../../lib/useFlipList';
import type { RankedEntry, RankMove } from './hooks/useLeaderboard';

const MEDAL = ['🥇', '🥈', '🥉'];
const xp = (score: number) => Math.round(score * 10);

interface LeaderboardPanelProps {
  entries: RankedEntry[];
  loading: boolean;
  onClose: () => void;
}

/** ▲2 / ▼1 after a rank change; a plain "+N" when only the score moved. */
function MoveChip({ move }: { move: RankMove | null }) {
  if (!move) return null;
  if (move.delta === 0) {
    return move.scoreDelta > 0 ? <span className="lb-chip bg-emerald-400/10 text-emerald-300">+{xp(move.scoreDelta)} XP</span> : null;
  }
  const up = move.delta > 0;
  return (
    <span className={`lb-chip ${up ? 'bg-emerald-400/15 text-emerald-300' : 'bg-rose-400/15 text-rose-300'}`} title={up ? `Up ${move.delta}` : `Down ${-move.delta}`}>
      {up ? '▲' : '▼'}
      {Math.abs(move.delta)}
    </span>
  );
}

/** A short glow on the row whenever its owner's score or place has just changed. */
function useFlashOnMove(rowRef: RefObject<HTMLLIElement | null>, move: RankMove | null, color: string) {
  const at = move?.at;
  useEffect(() => {
    const el = rowRef.current;
    if (!at || !el || typeof el.animate !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    el.animate([{ boxShadow: `inset 0 0 0 999px ${color}44` }, { boxShadow: `inset 0 0 0 999px ${color}00` }], { duration: 1500, easing: 'ease-out' });
  }, [rowRef, at, color]);
}

function PodiumSpot({ entry, place, meId }: { entry: RankedEntry | undefined; place: 0 | 1 | 2; meId: string | undefined }) {
  const heights = [52, 38, 28];
  if (!entry) return <div className="flex-1" />;
  const me = entry.userId === meId;
  return (
    <div key={entry.userId} className="flex min-w-0 flex-1 flex-col items-center animate-pop-in" aria-label={`Rank ${place + 1}: ${entry.name}, ${entry.score.toFixed(1)}`}>
      <div className="relative">
        {place === 0 && <Icon name="crown" filled className="absolute -top-4 left-1/2 h-5 w-5 -translate-x-1/2 text-amber-300 drop-shadow-[0_0_6px_rgba(251,191,36,0.8)]" />}
        <PlayerAvatar userId={entry.userId} name={entry.name} color={entry.color} size={place === 0 ? 50 : 40} />
        <span className="absolute -bottom-1 -right-1 text-sm leading-none">{MEDAL[place]}</span>
      </div>
      <p className={`mt-1.5 w-full truncate text-center text-xs font-semibold ${me ? 'text-cyan-200' : 'text-slate-100'}`}>{me ? 'You' : entry.name}</p>
      <div className="flex h-4 items-center">
        <MoveChip move={entry.move} />
      </div>
      <div
        className="mt-0.5 flex w-full items-start justify-center rounded-t-md border border-b-0 pt-1.5"
        style={{
          height: heights[place],
          borderColor: `${entry.color}88`,
          background: `linear-gradient(180deg, ${entry.color}33, ${entry.color}08)`,
        }}
      >
        <AnimatedNumber value={entry.score} decimals={1} className="font-mono text-xs font-bold text-emerald-300" />
      </div>
    </div>
  );
}

function Row({ entry, me, register }: { entry: RankedEntry; me: boolean; register: (el: HTMLLIElement | null) => void }) {
  const rowRef = useRef<HTMLLIElement | null>(null);
  useFlashOnMove(rowRef, entry.move, entry.color);
  return (
    <li
      ref={(el) => {
        rowRef.current = el;
        register(el);
      }}
      className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm ${me ? 'bg-cyan-400/10 ring-1 ring-cyan-400/40' : ''}`}
    >
      <span className="flex min-w-0 items-center gap-2 text-slate-200">
        <span className="w-5 shrink-0 text-center text-xs tabular-nums text-slate-500">{entry.rank}</span>
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: entry.color, boxShadow: `0 0 8px ${entry.color}99` }} />
        <span className="truncate">{me ? `${entry.name} (you)` : entry.name}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        <MoveChip move={entry.move} />
        <AnimatedNumber value={entry.score} decimals={1} className="font-mono text-xs font-bold text-emerald-400" />
      </span>
    </li>
  );
}

/** What the player has to do to climb: the gap to the player just above, or their lead if they are first. */
function useGap(entries: RankedEntry[], meId: string | undefined, rank: number | null, enabled: boolean) {
  const idx = meId ? entries.findIndex((e) => e.userId === meId) : -1;
  const inList = idx >= 0;
  const [far, setFar] = useState<NearMiss | null>(null);
  const scoreKey = inList ? '' : entries.map((e) => e.score).join(',');

  // Players below the visible board have no neighbour in the list: ask the server who is just above them.
  useEffect(() => {
    if (!enabled || !meId || inList || !rank) return;
    let cancelled = false;
    fetchNearMiss(meId)
      .then((m) => {
        if (!cancelled) setFar(m);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled, meId, inList, rank, scoreKey]);

  if (inList) {
    const me = entries[idx];
    if (idx > 0) return { kind: 'chase' as const, xp: Math.max(1, xp(entries[idx - 1].score) - xp(me.score) + 1), name: entries[idx - 1].name, rank: me.rank, score: me.score };
    const next = entries[1];
    return { kind: 'lead' as const, xp: next ? xp(me.score) - xp(next.score) : 0, name: next?.name ?? null, rank: me.rank, score: me.score };
  }
  if (far && far.nextRankName && far.pointsToNext > 0) {
    return { kind: 'chase' as const, xp: Math.round(far.pointsToNext * 10) + 1, name: far.nextRankName, rank: far.rank, score: null };
  }
  return null;
}

export function LeaderboardPanel({ entries, loading, onClose }: LeaderboardPanelProps) {
  const { user, isDemo, flavorTextEnabled, logout } = useAuth();
  const { stats } = usePlayerStats();
  const register = useFlipList(entries.map((e) => e.userId).join(','));
  const meId = isDemo ? undefined : user?.userId;
  // Live from the board when they are on it; the player's own numbers otherwise (outside the top 50).
  const mine = meId ? entries.find((e) => e.userId === meId) : undefined;
  const myRank = mine?.rank ?? stats.rank;
  const myScore = mine?.score ?? stats.totalScore;
  const gap = useGap(entries, meId, myRank, !isDemo && !loading);
  const rest = entries.slice(3);

  return (
    <div className="hud-panel hud-panel-quiet w-[19rem] max-w-[calc(100vw-1.5rem)] p-3 animate-slide-in-right">
      <div className="mb-2 flex items-center gap-2">
        <Icon name="trophy" className="h-4 w-4 text-amber-300" />
        <h2 className="font-display flex-1 text-sm font-bold uppercase tracking-[0.16em] text-slate-100">Leaderboard</h2>
        <span className="flex items-center gap-1 text-[0.62rem] font-bold uppercase tracking-wide text-emerald-400/80" title="Updates live as scores change">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-blink-soft" />
          Live
        </span>
        <button type="button" onClick={onClose} aria-label="Close leaderboard" className="rounded p-1 text-slate-500 transition-colors hover:text-slate-200">
          <Icon name="x" className="h-4 w-4" />
        </button>
      </div>

      {loading ? (
        <p className="animate-pulse py-3 text-center text-sm text-slate-400">Loading leaderboard…</p>
      ) : entries.length === 0 ? (
        <p className="py-3 text-center text-sm italic text-slate-500">{flavorTextEnabled ? EMPTY_LEADERBOARD : 'No scores yet'}</p>
      ) : (
        <>
          <div className="flex items-end gap-1.5 px-1 pt-5" role="group" aria-label="Top three">
            <PodiumSpot entry={entries[1]} place={1} meId={meId} />
            <PodiumSpot entry={entries[0]} place={0} meId={meId} />
            <PodiumSpot entry={entries[2]} place={2} meId={meId} />
          </div>

          {rest.length > 0 && (
            <ol className="relative mt-2 max-h-[min(9.5rem,calc(100dvh-var(--nav-h)-var(--tabbar-h)-30rem))] min-h-[3.5rem] space-y-0.5 overflow-y-auto pr-0.5">
              {rest.map((entry) => (
                <Row key={entry.userId} entry={entry} me={entry.userId === meId} register={register(entry.userId)} />
              ))}
            </ol>
          )}
        </>
      )}

      {/* The "you" row stays put however far down the list you are. */}
      <div className="mt-2 border-t border-slate-700/70 pt-2">
        {isDemo ? (
          <p className="text-xs leading-snug text-slate-400">
            Demo scores aren’t ranked.{' '}
            <button type="button" onClick={logout} className="font-semibold text-cyan-300 underline-offset-2 hover:underline">
              Sign in
            </button>{' '}
            to join the board.
          </p>
        ) : myRank ? (
          <div className="rounded-md bg-cyan-400/10 px-2 py-1.5 ring-1 ring-cyan-400/40" aria-live="polite">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="flex min-w-0 items-center gap-2 text-slate-100">
                <span className="w-7 shrink-0 text-center font-mono text-xs font-bold tabular-nums text-cyan-300">#{myRank}</span>
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: user?.color, boxShadow: `0 0 8px ${user?.color}99` }} />
                <span className="truncate font-semibold">You</span>
              </span>
              <span className="shrink-0 font-mono text-xs font-bold text-emerald-400">{myScore.toFixed(1)}</span>
            </div>
            {gap && gap.name && (
              <p className="mt-0.5 pl-9 text-[0.72rem] leading-snug text-slate-400">
                {gap.kind === 'chase' ? (
                  <>
                    <span className="font-mono font-bold text-amber-300">{gap.xp.toLocaleString('en-US')} XP</span> to pass {gap.name}
                  </>
                ) : (
                  <>
                    You lead — <span className="font-mono font-bold text-amber-300">{gap.xp.toLocaleString('en-US')} XP</span> ahead of {gap.name}
                  </>
                )}
              </p>
            )}
          </div>
        ) : (
          <p className="text-xs leading-snug text-slate-400">Solve a problem to get on the board.</p>
        )}
      </div>
    </div>
  );
}
