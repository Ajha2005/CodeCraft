import { useCollegeLeaderboard } from './hooks/useLeaderboard';
import { useAuth } from '../../auth/AuthContext';
import { EMPTY_LEADERBOARD, rankTitle } from '../../lib/flavorText';

const MEDAL = ['🥇', '🥈', '🥉'];

export function LeaderboardPanel() {
  const { entries, loading } = useCollegeLeaderboard();
  const { flavorTextEnabled } = useAuth();

  if (loading) {
    return (
      <div className="p-4 rounded-xl border border-slate-700 bg-slate-900/90 backdrop-blur-xl text-slate-400 text-sm animate-pulse">
        Loading leaderboard...
      </div>
    );
  }

  return (
    <div className="p-4 rounded-xl border border-amber-600/30 bg-slate-900/90 backdrop-blur-xl text-white w-64 shadow-[0_0_30px_-12px_rgba(201,162,39,0.4)] animate-pop-in">
      <h2
        className="text-xs font-bold mb-3 uppercase tracking-wide text-amber-400"
        style={{ fontFamily: "'Rajdhani', sans-serif" }}
      >
        College Leaderboard
      </h2>
      <ol className="space-y-1.5">
        {entries.map((entry, i) => (
          <li key={entry.userId} className="flex justify-between items-center text-sm">
            <span className="flex items-center gap-1.5 text-slate-300 min-w-0">
              <span className="w-5 text-center shrink-0">{MEDAL[i] ?? `#${i + 1}`}</span>
              <span className="truncate">{entry.name}</span>
              {flavorTextEnabled && (
                <span className="text-[10px] text-amber-400/70 uppercase tracking-wide shrink-0">{rankTitle(i + 1)}</span>
              )}
            </span>
            <span className="font-mono text-emerald-400 shrink-0 ml-2">{entry.score.toFixed(1)}</span>
          </li>
        ))}
        {entries.length === 0 && (
          <li className="text-slate-500 text-sm italic">
            {flavorTextEnabled ? EMPTY_LEADERBOARD : 'No scores yet'}
          </li>
        )}
      </ol>
    </div>
  );
}
