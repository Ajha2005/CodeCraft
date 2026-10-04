import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { EMPTY_LEADERBOARD } from '../../lib/flavorText';
import { colorForUser } from '../../lib/playerColor';
import type { LeaderboardEntry } from '../../lib/api';
import { Icon } from '../../components/ui/Icon';

const MEDAL = ['🥇', '🥈', '🥉'];

interface LeaderboardPanelProps {
  entries: LeaderboardEntry[];
  loading: boolean;
  onClose: () => void;
}

export function LeaderboardPanel({ entries, loading, onClose }: LeaderboardPanelProps) {
  const { user, flavorTextEnabled } = useAuth();

  return (
    <div className="hud-panel hud-panel-quiet w-[18rem] max-w-[calc(100vw-1.5rem)] p-3 animate-slide-in-right">
      <div className="mb-2 flex items-center gap-2">
        <Icon name="trophy" className="h-4 w-4 text-amber-300" />
        <h2 className="font-display flex-1 text-sm font-bold uppercase tracking-[0.16em] text-slate-100">Leaderboard</h2>
        <button type="button" onClick={onClose} aria-label="Close leaderboard" className="rounded p-1 text-slate-500 transition-colors hover:text-slate-200">
          <Icon name="x" className="h-4 w-4" />
        </button>
      </div>

      {loading ? (
        <p className="animate-pulse py-3 text-center text-sm text-slate-400">Loading leaderboard…</p>
      ) : (
        <ol className="max-h-[min(22rem,calc(100dvh-var(--nav-h)-var(--tabbar-h)-13rem))] space-y-1 overflow-y-auto pr-0.5">
          {entries.map((entry, i) => {
            const me = entry.userId === user?.userId;
            const color = colorForUser(entry.userId);
            return (
              <li
                key={entry.userId}
                className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm ${
                  me ? 'bg-cyan-400/10 ring-1 ring-cyan-400/40' : i < 3 ? 'bg-slate-800/50' : ''
                }`}
                style={{ animation: `slide-in-right 0.35s ${Math.min(i, 12) * 35}ms cubic-bezier(0.22,1,0.36,1) both` }}
              >
                <span className="flex min-w-0 items-center gap-2 text-slate-200">
                  <span className="w-5 shrink-0 text-center text-xs">{MEDAL[i] ?? <span className="text-slate-500">{i + 1}</span>}</span>
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
                  {entry.username ? (
                    <Link to={`/profile/${entry.username}`} className="truncate transition-colors hover:text-cyan-200 hover:underline">
                      {entry.name}
                    </Link>
                  ) : (
                    <span className="truncate">{entry.name}</span>
                  )}
                </span>
                <span className="shrink-0 font-mono text-xs font-bold text-emerald-400">{entry.score.toFixed(1)}</span>
              </li>
            );
          })}
          {entries.length === 0 && (
            <li className="py-3 text-center text-sm italic text-slate-500">{flavorTextEnabled ? EMPTY_LEADERBOARD : 'No scores yet'}</li>
          )}
        </ol>
      )}
    </div>
  );
}
