import { useEffect, useState } from 'react';
import {
  fetchUserScores,
  fetchUserTerritories,
  fetchDailyProgress,
  TEST_USER_ID,
} from '../api/client';
import type { ScoreResponse, Territory, DailyProgress } from '../api/client';

const TIER_COLORS: Record<string, string> = {
  OUTPOST: 'bg-slate-600',
  SETTLEMENT: 'bg-emerald-600',
  STRONGHOLD: 'bg-amber-600',
  CITADEL: 'bg-purple-600',
};

export default function ScoringDashboard() {
  const [scoreData, setScoreData] = useState<ScoreResponse | null>(null);
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [progress, setProgress] = useState<DailyProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetchUserScores(TEST_USER_ID),
      fetchUserTerritories(TEST_USER_ID),
      fetchDailyProgress(TEST_USER_ID),
    ])
      .then(([scores, terr, prog]) => {
        setScoreData(scores);
        setTerritories(terr);
        setProgress(prog);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 text-slate-300">Loading dashboard...</div>;
  if (error) return <div className="p-8 text-red-400">Error: {error}</div>;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-8">
      <h1 className="text-3xl font-bold mb-6">CodeCraft — Scoring Dashboard</h1>

      <div className="grid grid-cols-2 gap-4 mb-8">
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-800">
          <p className="text-slate-400 text-sm">Total Performance Score</p>
          <p className="text-4xl font-bold text-emerald-400">
            {scoreData?.totalScore.toFixed(1)}
          </p>
        </div>
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-800">
          <p className="text-slate-400 text-sm">Daily Qualifying Solves</p>
          <p className="text-4xl font-bold">
            {progress?.qualifyingCount} / {progress?.cap}
          </p>
          {progress && progress.qualifyingCount >= progress.cap && (
            <p className="text-amber-400 text-xs mt-1">Practice mode — cap reached</p>
          )}
        </div>
      </div>

      <h2 className="text-xl font-semibold mb-3">Your Territories</h2>
      <div className="grid grid-cols-3 gap-4 mb-8">
        {territories.length === 0 && (
          <p className="text-slate-500 col-span-3">No territories owned yet.</p>
        )}
        {territories.map((t) => (
          <div
            key={t.id}
            className="bg-slate-900 rounded-xl p-4 border border-slate-800"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium">{t.territory.name}</span>
              <span
                className={`text-xs px-2 py-1 rounded ${TIER_COLORS[t.territory.tier] ?? 'bg-slate-600'}`}
              >
                {t.territory.tier}
              </span>
            </div>
            <p className="text-slate-400 text-xs">
              via {t.sourceType} · {new Date(t.assignedAt).toLocaleDateString()}
            </p>
          </div>
        ))}
      </div>

      <h2 className="text-xl font-semibold mb-3">Solve History</h2>
      <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-800 text-slate-400">
            <tr>
              <th className="text-left p-3">Date</th>
              <th className="text-right p-3">Difficulty Wt</th>
              <th className="text-right p-3">Attempts Penalty</th>
              <th className="text-right p-3">Time Bonus</th>
              <th className="text-right p-3">Total</th>
            </tr>
          </thead>
          <tbody>
            {scoreData?.scores.map((s) => (
              <tr key={s.id} className="border-t border-slate-800">
                <td className="p-3 text-slate-300">
                  {new Date(s.createdAt).toLocaleString()}
                </td>
                <td className="p-3 text-right">{s.difficultyWeight}</td>
                <td className="p-3 text-right text-red-400">
                  -{s.attemptsPenalty.toFixed(1)}
                </td>
                <td className="p-3 text-right text-emerald-400">
                  +{s.timeEfficiency.toFixed(1)}
                </td>
                <td className="p-3 text-right font-semibold">
                  {s.totalScore.toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
