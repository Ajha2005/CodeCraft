import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { AnimatedNumber } from '../components/ui/AnimatedNumber';
import { Icon } from '../components/ui/Icon';
import { LevelBadge } from '../components/ui/LevelBadge';
import { ProgressRing } from '../components/ui/ProgressRing';
import { SectionTitle } from '../components/ui/SectionTitle';
import { XPBar } from '../components/ui/XPBar';
import { clearDemoProgress, useDemoState } from '../lib/demoStore';
import { formatXp, levelFromScore } from '../lib/progression';

/**
 * The scoreboard for demo players. Everything here is read from this device:
 * there is no rank, no streak and no territory to report, and the page says why.
 */
export default function DemoScoring() {
  const { logout } = useAuth();
  const { solves } = useDemoState();
  const total = useMemo(() => solves.reduce((sum, s) => sum + s.totalScore, 0), [solves]);
  const level = levelFromScore(total);

  return (
    <div className="hud-grid-bg min-h-[calc(100dvh-var(--nav-h))] flex-1">
      <div className="relative z-10 mx-auto max-w-4xl px-4 py-6 md:px-8 md:py-10">
        <header className="hud-panel relative mb-6 overflow-hidden p-5 md:p-7 animate-fade-in-up">
          <div className="relative grid items-center gap-6 md:grid-cols-[auto_1fr]">
            <ProgressRing pct={level.pct} size={132} stroke={9} color="#fbbf24" className="mx-auto md:mx-0">
              <LevelBadge level={level.level} size={84} />
            </ProgressRing>
            <div className="min-w-0 text-center md:text-left">
              <p className="hud-label text-amber-300">Demo scoreboard</p>
              <h1 className="font-display mt-1 text-4xl font-bold leading-none tracking-wide text-slate-50 sm:text-5xl">Guest</h1>
              <div className="mt-4 max-w-md">
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
            </div>
          </div>
        </header>

        <div className="mb-8 grid grid-cols-2 gap-3">
          <div className="hud-panel p-4 animate-fade-in-up">
            <p className="hud-label !text-[0.64rem]">Performance score</p>
            <p className="mt-1.5 font-mono text-3xl font-bold tabular-nums text-emerald-300">
              <AnimatedNumber value={total} decimals={1} />
            </p>
          </div>
          <div className="hud-panel p-4 animate-fade-in-up" style={{ animationDelay: '60ms' }}>
            <p className="hud-label !text-[0.64rem]">Problems cleared</p>
            <p className="mt-1.5 font-mono text-3xl font-bold tabular-nums text-slate-50">
              <AnimatedNumber value={solves.length} />
            </p>
          </div>
        </div>

        <section className="hud-panel mb-8 flex flex-wrap items-center gap-4 border-amber-400/30 p-5 animate-fade-in-up">
          <Icon name="flag" className="h-8 w-8 shrink-0 text-amber-300" />
          <div className="min-w-0 flex-1 basis-64">
            <p className="font-display text-lg font-bold uppercase tracking-wide text-slate-50">Want a cell for every solve?</p>
            <p className="mt-0.5 text-sm text-slate-400">
              Thapar students sign in with their college Google account. Solves then earn cells on the campus map, a rank on the leaderboard and duels
              against rivals. Your demo score stays on this device either way.
            </p>
          </div>
          <button type="button" onClick={logout} className="btn-primary h-10 rounded-lg px-5 text-sm">
            Sign in with Thapar ID
          </button>
        </section>

        <section>
          <SectionTitle icon="list">Solve history</SectionTitle>
          <div className="hud-panel hud-panel-quiet overflow-hidden animate-fade-in-up">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-800/50 text-slate-400">
                  <tr className="hud-label !text-[0.64rem]">
                    <th className="p-3 text-left font-bold">Problem</th>
                    <th className="p-3 text-right font-bold">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {solves.length === 0 && (
                    <tr>
                      <td colSpan={2} className="p-8 text-center text-sm italic text-slate-500">
                        Nothing solved yet.{' '}
                        <Link to="/" className="not-italic font-semibold text-cyan-300 hover:text-cyan-200">
                          Pick a problem
                        </Link>
                        .
                      </td>
                    </tr>
                  )}
                  {solves.map((s) => (
                    <tr key={s.problemId} className="border-t border-slate-800/80">
                      <td className="p-3">
                        <p className="font-semibold text-slate-100">{s.title}</p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {s.difficultyLevel} · {new Date(s.createdAt).toLocaleString()}
                        </p>
                      </td>
                      <td className="p-3 text-right font-mono font-bold text-slate-50">
                        {s.totalScore.toFixed(1)}
                        <span className="mt-0.5 block text-[0.7rem] font-semibold text-amber-300/80">+{Math.round(s.totalScore * 10)} XP</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {solves.length > 0 && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Clear your demo score and start again?')) clearDemoProgress();
              }}
              className="btn-ghost mx-auto mt-3 h-9 rounded-lg px-4 text-xs font-bold uppercase tracking-wide"
            >
              Reset demo progress
            </button>
          )}
        </section>
      </div>
    </div>
  );
}
