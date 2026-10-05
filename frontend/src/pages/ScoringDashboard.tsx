import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  fetchUserScores,
  fetchUserTerritories,
  fetchDailyProgress,
  fetchUserRank,
  fetchNearMiss,
  type ScoreResponse,
  type Territory,
  type DailyProgress,
  type NearMiss,
} from '../api/client';
import { fetchStreak, type StreakInfo } from '../lib/api';
import { useAuth } from '../auth/useAuth';
import { ToastStack } from '../components/ToastStack';
import { useToasts } from '../lib/useToasts';
import { rankTitle, rankUpToast, nearMissNudge } from '../lib/flavorText';
import { formatXp, levelFromScore } from '../lib/progression';
import { computeAchievements } from '../lib/achievements';
import { TIER_META, tierOf, type Tier } from '../lib/tiers';
import { AnimatedNumber } from '../components/ui/AnimatedNumber';
import { Icon } from '../components/ui/Icon';
import { LevelBadge } from '../components/ui/LevelBadge';
import { ProgressRing } from '../components/ui/ProgressRing';
import { SectionTitle } from '../components/ui/SectionTitle';
import { Sparkline } from '../components/ui/Sparkline';
import { TierBadge } from '../components/ui/TierBadge';
import { XPBar } from '../components/ui/XPBar';

const RANK_STORAGE_PREFIX = 'lastKnownRankTitle:';
const ACHIEVEMENTS_PREFIX = 'cc.achievements.v1:';
const EXPLORED_PREFIX = 'cc.map.explored.v1:';
const SOLVES_SHOWN = 8;

function readExploredCount(userId: string): number {
  try {
    const raw = localStorage.getItem(EXPLORED_PREFIX + userId);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.length : 0;
  } catch {
    return 0;
  }
}

function StatTile({
  label,
  children,
  accent,
  delay,
  sub,
  className = '',
}: {
  label: string;
  children: React.ReactNode;
  accent: string;
  delay: number;
  sub?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`hud-panel relative overflow-hidden p-4 animate-fade-in-up ${className}`} style={{ animationDelay: `${delay}ms` }}>
      <span className="absolute inset-x-0 top-0 h-[2px]" style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }} />
      <p className="hud-label !text-[0.64rem]">{label}</p>
      <div className="mt-1.5 font-mono text-3xl font-bold tabular-nums text-slate-50">{children}</div>
      {sub && <div className="mt-1.5 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

export default function ScoringDashboard() {
  const { user, flavorTextEnabled } = useAuth();
  const { toasts, push, dismiss } = useToasts();
  const [scoreData, setScoreData] = useState<ScoreResponse | null>(null);
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [progress, setProgress] = useState<DailyProgress | null>(null);
  const [rank, setRank] = useState<number | null>(null);
  const [nearMiss, setNearMiss] = useState<NearMiss | null>(null);
  const [streak, setStreak] = useState<StreakInfo | null>(null);
  const [showAllSolves, setShowAllSolves] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      fetchUserScores(),
      fetchUserTerritories(),
      fetchDailyProgress(),
      fetchUserRank(),
      fetchNearMiss(),
      fetchStreak().catch(() => null),
    ])
      .then(([scores, terr, prog, rankInfo, miss, streakInfo]) => {
        setScoreData(scores);
        setTerritories(terr);
        setProgress(prog);
        setRank(rankInfo.rank);
        setNearMiss(miss);
        setStreak(streakInfo);

        const title = rankTitle(rankInfo.rank);
        const key = RANK_STORAGE_PREFIX + user.userId;
        const previousTitle = localStorage.getItem(key);
        if (flavorTextEnabled && previousTitle && previousTitle !== title) {
          push(rankUpToast(previousTitle, title), 'success', 6000);
        }
        localStorage.setItem(key, title);

        // Toast any achievement that unlocked since the last visit. The very
        // first visit only records the baseline, so veterans are not spammed.
        const earned = computeAchievements({
          solves: scores.scores.length,
          hardestWeight: Math.max(0, ...scores.scores.map((s) => s.difficultyWeight)),
          longestStreak: streakInfo?.longest ?? 0,
          territoriesHeld: terr.length,
          hasCitadel: terr.some((t) => tierOf(t.territory.tier) === 'CITADEL'),
          rank: rankInfo.rank,
          dailyCapReached: prog.qualifyingCount >= prog.cap,
          explored: readExploredCount(user.userId),
        }).filter((a) => a.unlocked);
        const achKey = ACHIEVEMENTS_PREFIX + user.userId;
        try {
          const raw = localStorage.getItem(achKey);
          const known = new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
          if (raw !== null) {
            for (const a of earned) if (!known.has(a.id)) push(`Achievement unlocked: ${a.name}`, 'success', 6000);
          }
          localStorage.setItem(achKey, JSON.stringify(earned.map((a) => a.id)));
        } catch {
          // best-effort only
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const totalScore = scoreData?.totalScore ?? 0;
  const level = useMemo(() => levelFromScore(totalScore), [totalScore]);
  const history = useMemo(() => {
    const asc = [...(scoreData?.scores ?? [])].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    return asc.reduce<number[]>((acc, s) => {
      acc.push((acc[acc.length - 1] ?? 0) + s.totalScore);
      return acc;
    }, []);
  }, [scoreData]);
  const tierMix = useMemo(() => {
    const mix: Record<Tier, number> = { OUTPOST: 0, SETTLEMENT: 0, STRONGHOLD: 0, CITADEL: 0 };
    for (const t of territories) mix[tierOf(t.territory.tier)]++;
    return mix;
  }, [territories]);
  const achievements = useMemo(
    () =>
      computeAchievements({
        solves: scoreData?.scores.length ?? 0,
        hardestWeight: Math.max(0, ...(scoreData?.scores ?? []).map((s) => s.difficultyWeight)),
        longestStreak: streak?.longest ?? 0,
        territoriesHeld: territories.length,
        hasCitadel: tierMix.CITADEL > 0,
        rank,
        dailyCapReached: !!progress && progress.qualifyingCount >= progress.cap,
        explored: user ? readExploredCount(user.userId) : 0,
      }),
    [scoreData, streak, territories, tierMix, rank, progress, user],
  );
  const unlockedCount = achievements.filter((a) => a.unlocked).length;

  if (loading) {
    return (
      <div className="hud-grid-bg flex min-h-[calc(100dvh-var(--nav-h))] flex-1 items-center justify-center">
        <div className="relative z-10 flex flex-col items-center gap-4">
          <div className="relative h-14 w-14">
            <div className="hex absolute inset-0 animate-spin-slow bg-gradient-to-b from-cyan-400/80 to-teal-600/30" />
            <div className="hex absolute inset-[3px] bg-slate-950" />
          </div>
          <p className="font-display text-sm font-bold uppercase tracking-[0.3em] text-cyan-300">Compiling campaign report…</p>
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="hud-grid-bg flex min-h-[calc(100dvh-var(--nav-h))] flex-1 items-center justify-center">
        <p className="relative z-10 text-rose-400">Error: {error}</p>
      </div>
    );
  }

  const name = user?.isGuest ? 'Commander' : user?.username || 'Commander';

  return (
    <div className="hud-grid-bg min-h-[calc(100dvh-var(--nav-h))] flex-1">
      <div className="relative z-10 mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-10">
        <ToastStack toasts={toasts} dismiss={dismiss} placement="top-right" />

        {/* ------------------------------------------------------ hero */}
        <header className="hud-panel relative mb-6 overflow-hidden p-5 md:p-7 animate-fade-in-up">
          <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-amber-400/10 blur-3xl" />
          <div className="relative grid items-center gap-6 md:grid-cols-[auto_1fr]">
            <ProgressRing pct={level.pct} size={148} stroke={9} color="#fbbf24" className="mx-auto md:mx-0">
              <LevelBadge level={level.level} size={96} />
            </ProgressRing>

            <div className="min-w-0 text-center md:text-left">
              <p className="hud-label text-cyan-300">Campaign report</p>
              <h1 className="font-display mt-1 truncate text-4xl font-bold leading-none tracking-wide text-slate-50 sm:text-5xl">{name}</h1>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 md:justify-start">
                {rank && (
                  <span className="font-display text-base font-bold uppercase tracking-[0.14em] text-cyan-300">
                    {flavorTextEnabled ? rankTitle(rank) : 'Rank'} <span className="text-slate-100">#{rank}</span>
                  </span>
                )}
                {streak && streak.current > 0 && (
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-orange-300">
                    <Icon name="flame" filled className="h-5 w-5" />
                    {streak.current}-day streak
                  </span>
                )}
              </div>
              <div className="mt-4 max-w-md md:max-w-lg">
                <XPBar pct={level.pct} />
                <p className="mt-1.5 flex justify-between text-xs font-semibold tabular-nums text-slate-400">
                  <span>
                    {formatXp(level.xpIntoLevel)} / {formatXp(level.xpSpan)} XP
                  </span>
                  <span className="text-amber-300/90">
                    {formatXp(level.xpToNext)} to level {level.level + 1}
                  </span>
                </p>
              </div>
              {flavorTextEnabled && nearMiss && nearMiss.pointsToNext > 0 && (
                <p className="mt-3 text-xs leading-snug text-slate-400">{nearMissNudge(nearMiss.pointsToNext, nearMiss.nextRankName)}</p>
              )}
            </div>
          </div>
        </header>

        {/* ------------------------------------------------ stat tiles */}
        <div className="mb-10 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatTile label="Performance score" accent="#34d399" delay={100}>
            <span className="text-emerald-300">
              <AnimatedNumber value={totalScore} decimals={1} />
            </span>
          </StatTile>
          <StatTile label="Problems cleared" accent="#a78bfa" delay={160}>
            <AnimatedNumber value={scoreData?.scores.length ?? 0} />
          </StatTile>
          <StatTile
            className="col-span-2 sm:col-span-1"
            label="Zones held"
            accent="#fbbf24"
            delay={220}
            sub={
              territories.length === 0 ? (
                <span>None yet</span>
              ) : (
                <span className="flex items-center gap-2.5">
                  {(Object.keys(tierMix) as Tier[])
                    .filter((t) => tierMix[t] > 0)
                    .map((t) => (
                      <span key={t} className="flex items-center gap-1" style={{ color: TIER_META[t].accent }} title={TIER_META[t].label}>
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
                          <path d={TIER_META[t].icon} />
                        </svg>
                        <span className="font-mono font-bold">{tierMix[t]}</span>
                      </span>
                    ))}
                </span>
              )
            }
          >
            <AnimatedNumber value={territories.length} />
          </StatTile>
        </div>

        {/* ---------------------------------------------- score history */}
        {history.length >= 2 && (
          <section className="mb-10 animate-fade-in-up" style={{ animationDelay: '120ms' }}>
            <SectionTitle icon="chart">Score over time</SectionTitle>
            <div className="hud-panel p-4 md:p-5">
              <Sparkline values={history} width={960} height={140} color="#22d3ee" className="h-auto w-full" />
              <div className="mt-2 flex justify-between text-xs font-semibold tabular-nums text-slate-500">
                <span>0</span>
                <span className="text-cyan-300">{history[history.length - 1].toFixed(1)} pts across {history.length} solves</span>
              </div>
            </div>
          </section>
        )}

        {/* ---------------------------------------------- territories */}
        <section className="mb-10">
          <SectionTitle icon="flag">Your territories</SectionTitle>
          {territories.length === 0 ? (
            <div className="hud-panel hud-panel-quiet p-8 text-center">
              <Icon name="map" className="mx-auto h-10 w-10 text-slate-600" />
              <p className="mt-3 text-sm italic text-slate-500">
                {flavorTextEnabled ? 'Uncharted. Every empire starts with one soldier and one problem.' : 'No territories owned yet.'}
              </p>
              <Link to="/" className="btn-primary mt-4 inline-flex h-10 rounded-lg px-5 text-sm">
                Find a problem to solve
              </Link>
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {territories.map((t, i) => {
                const meta = TIER_META[tierOf(t.territory.tier)];
                return (
                  <Link
                    key={t.id}
                    to={`/map?territory=${t.territory.id}`}
                    title="Show on map"
                    className="group hud-panel hud-panel-quiet relative flex items-center gap-3 overflow-hidden py-2.5 pl-4 pr-3 transition-colors hover:border-cyan-400/40 animate-fade-in-up"
                    style={{ animationDelay: `${Math.min(i, 10) * 35}ms` }}
                  >
                    <span className="absolute inset-y-0 left-0 w-1" style={{ background: meta.accent, opacity: 0.8 }} />
                    <p className="font-display min-w-0 flex-1 truncate text-lg font-bold tracking-wide text-slate-50">{t.territory.name}</p>
                    <TierBadge tier={t.territory.tier} />
                    <Icon name="arrowRight" className="h-4 w-4 shrink-0 text-slate-600 transition-all group-hover:translate-x-0.5 group-hover:text-cyan-300" />
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        {/* -------------------------------------------- achievements */}
        <section className="mb-10">
          <SectionTitle
            icon="trophy"
            aside={
              <span className="font-mono text-xs font-bold tabular-nums text-amber-300">
                {unlockedCount}/{achievements.length}
              </span>
            }
          >
            Achievements
          </SectionTitle>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {achievements.map((a, i) => (
              <div
                key={a.id}
                className="hud-panel hud-panel-quiet flex items-center gap-3 p-2.5 animate-fade-in-up"
                style={{ animationDelay: `${Math.min(i, 12) * 30}ms`, borderColor: a.unlocked ? `${a.color}55` : undefined }}
                title={a.description}
              >
                <div className="relative h-11 w-11 shrink-0">
                  <div className="hex absolute inset-0" style={{ background: a.unlocked ? `linear-gradient(160deg, ${a.color}, ${a.color}44)` : 'rgba(51,65,85,0.6)' }} />
                  <div className="hex absolute inset-[2px] flex items-center justify-center bg-slate-950">
                    <Icon name={a.unlocked ? a.icon : 'lock'} className="h-5 w-5" style={{ color: a.unlocked ? a.color : '#475569' }} />
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`font-display truncate text-sm font-bold uppercase tracking-wide ${a.unlocked ? 'text-slate-50' : 'text-slate-500'}`}>{a.name}</p>
                  {a.unlocked ? (
                    <p className="truncate text-[0.7rem] text-slate-500">{a.description}</p>
                  ) : (
                    <div className="mt-1 flex items-center gap-2">
                      <XPBar pct={a.progress / a.target} tone="cyan" height={4} className="flex-1" />
                      <span className="font-mono text-[0.62rem] font-bold tabular-nums text-slate-500">
                        {a.progress}/{a.target}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ------------------------------------------------ battle log */}
        <section>
          <SectionTitle icon="list">Solve history</SectionTitle>
          <div className="hud-panel hud-panel-quiet overflow-hidden animate-fade-in-up">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-800/50 text-slate-400">
                  <tr className="hud-label !text-[0.64rem]">
                    <th className="p-3 text-left font-bold">Date</th>
                    <th className="p-3 text-right font-bold">Difficulty</th>
                    <th className="p-3 text-right font-bold">Penalty</th>
                    <th className="p-3 text-right font-bold">Speed</th>
                    <th className="p-3 text-right font-bold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {scoreData?.scores.length === 0 && (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-sm italic text-slate-500">
                        No solves logged yet — deploy your first solution to start the record.
                      </td>
                    </tr>
                  )}
                  {(showAllSolves ? scoreData?.scores : scoreData?.scores.slice(0, SOLVES_SHOWN))?.map((s) => (
                    <tr key={s.id} className="border-t border-slate-800/80 transition-colors hover:bg-cyan-400/5">
                      <td className="whitespace-nowrap p-3 text-slate-300">{new Date(s.createdAt).toLocaleString()}</td>
                      <td className="p-3 text-right font-mono">{s.difficultyWeight}</td>
                      <td className="p-3 text-right font-mono text-rose-400">-{s.attemptsPenalty.toFixed(1)}</td>
                      <td className="p-3 text-right font-mono text-emerald-400">+{s.timeEfficiency.toFixed(1)}</td>
                      <td className="p-3 text-right font-mono font-bold text-slate-50">
                        {s.totalScore.toFixed(1)} <span className="text-[0.7rem] font-semibold text-amber-300/80">+{Math.round(s.totalScore * 10)} XP</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {(scoreData?.scores.length ?? 0) > SOLVES_SHOWN && (
            <button type="button" onClick={() => setShowAllSolves((v) => !v)} className="btn-ghost mx-auto mt-3 h-9 rounded-lg px-4 text-xs font-bold uppercase tracking-wide">
              {showAllSolves ? 'Show fewer' : `Show all ${scoreData?.scores.length}`}
            </button>
          )}
        </section>
      </div>
    </div>
  );
}
