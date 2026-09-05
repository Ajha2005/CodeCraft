import { useTerritoryLeaderboard } from './hooks/useLeaderboard';
import { useAuth } from '../../auth/AuthContext';
import type { TerritoryDto } from '../../types/territory';

const MEDAL = ['🥇', '🥈', '🥉'];

interface TerritoryLeaderboardProps {
  territory: TerritoryDto | null;
}

export function TerritoryLeaderboard({ territory }: TerritoryLeaderboardProps) {
  const { entries, loading } = useTerritoryLeaderboard(territory?.id ?? null);
  const { flavorTextEnabled } = useAuth();

  if (!territory) return null;

  return (
    <div className="p-4 rounded-xl border border-cyan-600/30 bg-slate-900/90 backdrop-blur-xl text-white w-72 shadow-[0_0_30px_-12px_rgba(34,211,238,0.4)] animate-pop-in">
      <h3 className="text-md font-bold text-slate-100" style={{ fontFamily: "'Rajdhani', sans-serif" }}>
        {territory.name}
      </h3>
      <p className={`text-xs mb-3 font-medium ${territory.ownerId ? 'text-orange-400' : 'text-slate-500'}`}>
        {territory.ownerId ? '⚔️ Contested' : 'Unclaimed'}
      </p>
      {loading ? (
        <p className="text-slate-400 text-sm animate-pulse">Loading...</p>
      ) : (
        <ol className="space-y-1.5">
          {entries.map((entry, i) => (
            <li key={entry.userId} className="flex justify-between items-center text-sm">
              <span className="flex items-center gap-1.5 text-slate-300 min-w-0">
                <span className="w-5 text-center shrink-0">{MEDAL[i] ?? `#${i + 1}`}</span>
                <span className="truncate">{entry.name}</span>
              </span>
              <span className="font-mono text-emerald-400 shrink-0 ml-2">{entry.score.toFixed(1)}</span>
            </li>
          ))}
          {entries.length === 0 && (
            <li className="text-slate-500 text-sm italic">
              {flavorTextEnabled ? 'No ruler yet. Could be you.' : 'No activity yet'}
            </li>
          )}
        </ol>
      )}
    </div>
  );
}
