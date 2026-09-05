import { useCollegeLeaderboard } from './hooks/useLeaderboard';

export function LeaderboardPanel() {
  const { entries, loading } = useCollegeLeaderboard();

  if (loading) return <div className="p-4 text-slate-400">Loading leaderboard...</div>;

  return (
    <div className="p-4 bg-slate-800 rounded-lg text-white w-64">
      <h2 className="text-lg font-semibold mb-3">College Leaderboard</h2>
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
          <li className="text-slate-500 text-sm">No scores yet</li>
        )}
      </ol>
    </div>
  );
}