import { useEffect, useState } from 'react';
import {
  fetchUserScores,
  fetchUserTerritories,
  fetchDailyProgress,
  fetchUserRank,
  fetchNearMiss,
  fetchCampaignSummary,
  type ScoreResponse,
  type Territory,
  type DailyProgress,
  type NearMiss,
  type CampaignSummary,
} from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { StreakBadge } from '../components/StreakBadge';
import { ToastStack } from '../components/ToastStack';
import { useToasts } from '../lib/useToasts';
import { rankTitle, rankUpToast, nearMissNudge } from '../lib/flavorText';

const TIER_COLORS: Record<string, string> = {
  OUTPOST: 'bg-slate-600',
  SETTLEMENT: 'bg-emerald-600',
  STRONGHOLD: 'bg-amber-600',
  CITADEL: 'bg-purple-600',
};

const RANK_STORAGE_PREFIX = 'lastKnownRankTitle:';

export default function ScoringDashboard() {
  const { user, flavorTextEnabled } = useAuth();
  const { toasts, push, dismiss } = useToasts();
  const [scoreData, setScoreData] = useState<ScoreResponse | null>(null);
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [progress, setProgress] = useState<DailyProgress | null>(null);
  const [rank, setRank] = useState<number | null>(null);
  const [nearMiss, setNearMiss] = useState<NearMiss | null>(null);
  const [campaign, setCampaign] = useState<CampaignSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      fetchUserScores(user.userId),
      fetchUserTerritories(user.userId),
      fetchDailyProgress(user.userId),
      fetchUserRank(user.userId),
      fetchNearMiss(user.userId),
      fetchCampaignSummary(user.userId),
    ])
      .then(([scores, terr, prog, rankInfo, miss, campaignSummary]) => {
        setScoreData(scores);
        setTerritories(terr);
        setProgress(prog);
        setRank(rankInfo.rank);
        setNearMiss(miss);
        setCampaign(campaignSummary);

        const title = rankTitle(rankInfo.rank);
        const key = RANK_STORAGE_PREFIX + user.userId;
        const previousTitle = localStorage.getItem(key);
        if (flavorTextEnabled && previousTitle && previousTitle !== title) {
          push(rankUpToast(previousTitle, title), 'success', 6000);
        }
        localStorage.setItem(key, title);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  if (loading) return <div className="p-8 text-slate-300">Loading dashboard...</div>;
  if (error) return <div className="p-8 text-red-400">Error: {error}</div>;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-8">
      <ToastStack toasts={toasts} dismiss={dismiss} />
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-3xl font-bold" style={{ color: '#f1f5f9' }}>
          CodeCraft — Scoring Dashboard
        </h1>
        {user && <StreakBadge userId={user.userId} />}
      </div>

      {flavorTextEnabled && campaign && (
        <div className="mb-6 bg-slate-900 border border-slate-800 rounded-xl p-4 text-sm">
          <p className="text-amber-400 font-medium mb-1">Today's campaign</p>
          <p className="text-slate-300">
            {campaign.territoriesHeld} {campaign.territoriesHeld === 1 ? 'territory' : 'territories'} held ·{' '}
            {campaign.cellsGainedToday} gained · {campaign.cellsLostToday} lost. Tomorrow's a new front.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 mb-4">
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

      <div className="bg-slate-900 rounded-xl p-4 border border-slate-800 mb-8 flex items-center justify-between">
        <div>
          <p className="text-slate-400 text-sm">College Rank</p>
          <p className="text-xl font-bold">
            {rank ? `#${rank}` : 'Unranked'}
            {flavorTextEnabled && rank && (
              <span className="ml-2 text-sm font-normal text-amber-400">{rankTitle(rank)}</span>
            )}
          </p>
        </div>
        {flavorTextEnabled && nearMiss && nearMiss.pointsToNext > 0 && (
          <p className="text-slate-400 text-sm max-w-xs text-right">
            {nearMissNudge(nearMiss.pointsToNext, nearMiss.nextRankName)}
          </p>
        )}
      </div>

      <h2 className="text-xl font-semibold mb-3" style={{ color: '#f1f5f9' }}>
        Your Territories
      </h2>
      <div className="grid grid-cols-3 gap-4 mb-8">
        {territories.length === 0 && (
          <p className="text-slate-500 col-span-3 italic">
            {flavorTextEnabled
              ? 'Uncharted. Every empire starts with one soldier and one problem.'
              : 'No territories owned yet.'}
          </p>
        )}
        {territories.map((t) => (
          <div key={t.id} className="bg-slate-900 rounded-xl p-4 border border-slate-800">
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium">{t.territory.name}</span>
              <span className={`text-xs px-2 py-1 rounded ${TIER_COLORS[t.territory.tier] ?? 'bg-slate-600'}`}>
                {t.territory.tier}
              </span>
            </div>
            <p className="text-slate-400 text-xs">
              via {t.sourceType} · {new Date(t.assignedAt).toLocaleDateString()}
            </p>
          </div>
        ))}
      </div>
      <h2 className="text-xl font-semibold mb-3" style={{ color: '#f1f5f9' }}>
        Solve History
      </h2>
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
                <td className="p-3 text-slate-300">{new Date(s.createdAt).toLocaleString()}</td>
                <td className="p-3 text-right">{s.difficultyWeight}</td>
                <td className="p-3 text-right text-red-400">-{s.attemptsPenalty.toFixed(1)}</td>
                <td className="p-3 text-right text-emerald-400">+{s.timeEfficiency.toFixed(1)}</td>
                <td className="p-3 text-right font-semibold">{s.totalScore.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
