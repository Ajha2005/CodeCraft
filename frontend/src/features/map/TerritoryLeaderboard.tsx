import { Link } from 'react-router-dom';
import { useTerritoryLeaderboard } from './hooks/useLeaderboard';
import { useAuth } from '../../auth/useAuth';
import type { TerritoryDto } from '../../types/territory';

const MEDAL = ['🥇', '🥈', '🥉'];

interface TerritoryLeaderboardProps {
  territory: TerritoryDto | null;
}

/** Top contributors in one zone. Rows are tinted with each player's map color. */
export function TerritoryLeaderboard({ territory }: TerritoryLeaderboardProps) {
  const { entries, loading } = useTerritoryLeaderboard(territory?.id ?? null);
  const { flavorTextEnabled } = useAuth();

  if (!territory) return null;

  if (loading) {
    return <p className="animate-pulse py-2 text-center text-sm text-slate-400">Reading the scoreboard…</p>;
  }

  if (entries.length === 0) {
    return (
      <p className="py-2 text-center text-sm italic text-slate-500">
        {flavorTextEnabled ? 'No ruler yet. Could be you.' : 'No activity yet'}
      </p>
    );
  }

  return (
    <ol className="space-y-1">
      {entries.map((entry, i) => {
        const me = entry.isMe;
        const color = entry.color;
        return (
          <li
            key={entry.username}
            className={`flex items-center justify-between gap-2 rounded-md px-2 py-1 text-sm ${me ? 'bg-cyan-400/10 ring-1 ring-cyan-400/40' : 'bg-slate-900/40'}`}
            style={{ animation: `slide-in-right 0.35s ${i * 40}ms cubic-bezier(0.22,1,0.36,1) both` }}
          >
            <span className="flex min-w-0 items-center gap-2 text-slate-200">
              <span className="w-5 shrink-0 text-center text-xs">{MEDAL[i] ?? `#${i + 1}`}</span>
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
              <Link to={`/profile/${entry.username}`} className="truncate transition-colors hover:text-cyan-200 hover:underline">
                {entry.username}
              </Link>
              {me && <span className="shrink-0 rounded bg-cyan-400/20 px-1 text-[0.6rem] font-bold uppercase text-cyan-300">you</span>}
            </span>
            <span className="shrink-0 font-mono text-xs font-bold text-emerald-400">{entry.score.toFixed(1)}</span>
          </li>
        );
      })}
    </ol>
  );
}
