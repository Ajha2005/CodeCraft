import { useTerritoryLeaderboard } from './hooks/useLeaderboard';
import { useAuth } from '../../auth/AuthContext';
import type { TerritoryDto } from '../../types/territory';

interface TerritoryLeaderboardProps {
  territory: TerritoryDto | null;
}

export function TerritoryLeaderboard({ territory }: TerritoryLeaderboardProps) {
  const { entries, loading } = useTerritoryLeaderboard(territory?.id ?? null);
  const { flavorTextEnabled } = useAuth();

  if (!territory) return null;

  return (
    <div className="p-4 bg-slate-800 rounded-lg text-white w-64">
      <h3 className="text-md font-semibold mb-1">{territory.name}</h3>
      <p className="text-xs text-slate-400 mb-3">
        {territory.ownerId ? 'Contested' : 'Unclaimed'}
      </p>
      {loading ? (
        <p className="text-slate-400 text-sm">Loading...</p>
      ) : (
        <ol className="space-y-1">
          {entries.map((entry, i) => (
            <li key={entry.userId} className="flex justify-between text-sm">
              <span className="text-slate-300">
                #{i + 1} {entry.name}
              </span>
              <span className="font-mono">{entry.score.toFixed(1)}</span>
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