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

const TIER_STYLE: Record<string, { bg: string; text: string; border: string }> = {
  OUTPOST: { bg: 'bg-slate-500/10', text: 'text-slate-300', border: 'border-slate-500/40' },
  SETTLEMENT: { bg: 'bg-emerald-500/10', text: 'text-emerald-300', border: 'border-emerald-500/40' },
  STRONGHOLD: { bg: 'bg-amber-500/10', text: 'text-amber-300', border: 'border-amber-500/40' },
  CITADEL: { bg: 'bg-fuchsia-500/10', text: 'text-fuchsia-300', border: 'border-fuchsia-500/40' },
};
const DEFAULT_TIER_STYLE = { bg: 'bg-slate-500/10', text: 'text-slate-300', border: 'border-slate-500/40' };

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

  if (loading) {
    return (
      <div className="min-h-screen hud-grid-bg flex items-center justify-center">
        <p className="text-slate-400 animate-pulse">Loading campaign report…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="min-h-screen hud-grid-bg flex items-center justify-center">
        <p className="text-rose-400">Error: {error}</p>
      </div>
    );
  }

  const dailyPct = progress ? Math.min(100, Math.round((progress.qualifyingCount / progress.cap) * 100)) : 0;

  return (
    <div className="min-h-screen hud-grid-bg">
      <div className="max-w-6xl mx-auto p-6 md:p-8">
        <ToastStack toasts={toasts} dismiss={dismiss} />

        <div className="flex flex-wrap items-center justify-between gap-3 mb-6 animate-fade-in-up">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-500 to-rose-600 flex items-center justify-center text-sm font-bold text-white shadow-lg">
              {(user?.email?.[0] ?? '?').toUpperCase()}
            </div>
            <div>
              <h1
                className="text-2xl font-bold leading-tight"
                style={{ color: '#f1f5f9', fontFamily: "'Rajdhani', sans-serif" }}
              >
                Campaign Report
              </h1>
              {user && <StreakBadge userId={user.userId} />}
            </div>
          </div>
          {rank && (
            <div className="text-right">
              <p className="text-3xl font-bold font-mono text-amber-400">#{rank}</p>
              {flavorTextEnabled && <p className="text-xs text-slate-400 uppercase tracking-wide">{rankTitle(rank)}</p>}
            </div>
          )}
        </div>

        {flavorTextEnabled && campaign && (
          <div
            className="mb-6 rounded-xl border border-amber-600/30 bg-gradient-to-r from-amber-950/40 to-slate-900/60 backdrop-blur p-4 text-sm animate-fade-in-up"
            style={{ animationDelay: '60ms' }}
          >
            <p className="text-amber-400 font-semibold mb-1 uppercase tracking-wide text-xs">Today's campaign</p>
            <p className="text-slate-300">
              {campaign.territoriesHeld} {campaign.territoriesHeld === 1 ? 'territory' : 'territories'} held ·{' '}
              <span className="text-emerald-400">{campaign.cellsGainedToday} gained</span> ·{' '}
              <span className="text-rose-400">{campaign.cellsLostToday} lost</span>. Tomorrow's a new front.
            </p>
          </div>
        )}

        <div className="grid md:grid-cols-3 gap-4 mb-4">
          <div
            className="rounded-xl p-6 border border-emerald-800/40 bg-gradient-to-br from-emerald-950/50 to-slate-900/60 backdrop-blur animate-fade-in-up"
            style={{ animationDelay: '100ms' }}
          >
            <p className="text-slate-400 text-xs uppercase tracking-wide mb-1">Total Performance Score</p>
            <p className="text-4xl font-bold text-emerald-400 font-mono">
              {scoreData?.totalScore.toFixed(1)}
            </p>
          </div>

          <div
            className="rounded-xl p-6 border border-slate-800 bg-slate-900/60 backdrop-blur animate-fade-in-up"
            style={{ animationDelay: '160ms' }}
          >
            <p className="text-slate-400 text-xs uppercase tracking-wide mb-1">Daily Qualifying Solves</p>
            <p className="text-4xl font-bold text-slate-100 font-mono">
              {progress?.qualifyingCount} <span className="text-lg text-slate-500">/ {progress?.cap}</span>
            </p>
            <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden mt-2">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-500 transition-all duration-700"
                style={{ width: `${dailyPct}%` }}
              />
            </div>
            {progress && progress.qualifyingCount >= progress.cap && (
              <p className="text-amber-400 text-xs mt-2">Practice mode — cap reached</p>
            )}
          </div>

          <div
            className="rounded-xl p-6 border border-slate-800 bg-slate-900/60 backdrop-blur animate-fade-in-up"
            style={{ animationDelay: '220ms' }}
          >
            <p className="text-slate-400 text-xs uppercase tracking-wide mb-1">College Rank</p>
            <p className="text-4xl font-bold text-slate-100 font-mono">
              {rank ? `#${rank}` : '—'}
            </p>
            {flavorTextEnabled && nearMiss && nearMiss.pointsToNext > 0 ? (
              <p className="text-slate-400 text-xs mt-2">
                {nearMissNudge(nearMiss.pointsToNext, nearMiss.nextRankName)}
              </p>
            ) : (
              <p className="text-slate-500 text-xs mt-2">{rank ? rankTitle(rank) : 'Unranked'}</p>
            )}
          </div>
        </div>

        <h2
          className="text-lg font-bold mb-3 mt-8 uppercase tracking-wide"
          style={{ color: '#f1f5f9', fontFamily: "'Rajdhani', sans-serif" }}
        >
          Your Territories
        </h2>
        <div className="grid sm:grid-cols-3 gap-4 mb-8">
          {territories.length === 0 && (
            <p className="text-slate-500 col-span-3 italic text-sm">
              {flavorTextEnabled
                ? 'Uncharted. Every empire starts with one soldier and one problem.'
                : 'No territories owned yet.'}
            </p>
          )}
          {territories.map((t, i) => {
            const style = TIER_STYLE[t.territory.tier] ?? DEFAULT_TIER_STYLE;
            return (
              <div
                key={t.id}
                className="rounded-xl p-4 border border-slate-800 bg-slate-900/60 backdrop-blur hover:-translate-y-0.5 hover:border-slate-600 transition-all animate-fade-in-up"
                style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-slate-100">{t.territory.name}</span>
                  <span className={`text-[10px] px-2 py-1 rounded border ${style.bg} ${style.text} ${style.border} uppercase tracking-wide font-semibold`}>
                    {t.territory.tier}
                  </span>
                </div>
                <p className="text-slate-500 text-xs">
                  via {t.sourceType} · {new Date(t.assignedAt).toLocaleDateString()}
                </p>
              </div>
            );
          })}
        </div>

        <h2
          className="text-lg font-bold mb-3 uppercase tracking-wide"
          style={{ color: '#f1f5f9', fontFamily: "'Rajdhani', sans-serif" }}
        >
          Solve History
        </h2>
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 backdrop-blur overflow-hidden animate-fade-in-up">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-800/60 text-slate-400 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left p-3 font-medium">Date</th>
                  <th className="text-right p-3 font-medium">Difficulty Wt</th>
                  <th className="text-right p-3 font-medium">Attempts Penalty</th>
                  <th className="text-right p-3 font-medium">Time Bonus</th>
                  <th className="text-right p-3 font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {scoreData?.scores.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-slate-500 italic text-sm">
                      No solves logged yet — deploy your first solution to start the record.
                    </td>
                  </tr>
                )}
                {scoreData?.scores.map((s) => (
                  <tr key={s.id} className="border-t border-slate-800 hover:bg-slate-800/30 transition-colors">
                    <td className="p-3 text-slate-300">{new Date(s.createdAt).toLocaleString()}</td>
                    <td className="p-3 text-right font-mono">{s.difficultyWeight}</td>
                    <td className="p-3 text-right font-mono text-rose-400">-{s.attemptsPenalty.toFixed(1)}</td>
                    <td className="p-3 text-right font-mono text-emerald-400">+{s.timeEfficiency.toFixed(1)}</td>
                    <td className="p-3 text-right font-mono font-semibold text-slate-100">{s.totalScore.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
