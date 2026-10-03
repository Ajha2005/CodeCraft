import { Link } from 'react-router-dom';
import { useAuth } from '../../../auth/AuthContext';
import { usePlayerStats } from '../../../lib/playerStatsContext';
import { formatXp } from '../../../lib/progression';
import { rankTitle } from '../../../lib/flavorText';
import { LevelBadge } from '../../../components/ui/LevelBadge';
import { XPBar } from '../../../components/ui/XPBar';
import { Pips } from '../../../components/ui/Pips';
import { Icon } from '../../../components/ui/Icon';
import { useMediaQuery } from '../../../lib/useMediaQuery';

/** Top-left commander card: level medallion, XP, streak, daily quest. */
export function PlayerCard() {
  const { user, flavorTextEnabled } = useAuth();
  const { stats } = usePlayerStats();
  const compact = useMediaQuery('(max-width: 639px)');
  const name = user?.name?.trim() || user?.email?.split('@')[0] || 'Commander';
  const { level } = stats;

  return (
    <Link
      to="/scoring"
      className="hud-panel group flex w-[19.5rem] max-w-[calc(100vw-1.5rem)] items-center gap-3 p-3 pr-4 animate-slide-in-left transition-colors hover:border-cyan-400/50 max-sm:w-[11.75rem] max-sm:gap-2.5 max-sm:p-2 max-sm:pr-3"
      title="Open your campaign report"
    >
      <LevelBadge level={level.level} size={compact ? 40 : 54} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="font-display text-[1.05rem] font-bold leading-tight text-slate-50 truncate max-sm:text-sm">{name}</p>
          {stats.streak && stats.streak.current > 0 && (
            <span className="flex shrink-0 items-center gap-0.5 text-xs font-bold text-orange-400" title={`${stats.streak.current}-day streak`}>
              <Icon name="flame" filled className="h-3.5 w-3.5 drop-shadow-[0_0_6px_rgba(251,146,60,0.9)]" />
              {stats.streak.current}
            </span>
          )}
        </div>
        <p className="hud-label !text-[0.64rem] !tracking-[0.14em] text-cyan-300/80 truncate max-sm:hidden">
          {stats.rank ? `${flavorTextEnabled ? rankTitle(stats.rank) : 'Rank'} · #${stats.rank}` : `Level ${level.level}`}
        </p>
        <XPBar pct={level.pct} className="mt-1.5" />
        <div className="mt-1 flex items-center justify-between text-[0.66rem] font-semibold tabular-nums text-slate-400">
          <span>
            {formatXp(level.xpIntoLevel)} / {formatXp(level.xpSpan)} XP
          </span>
          <span className="hidden text-slate-500 sm:inline">{formatXp(level.xpToNext)} to LV {level.level + 1}</span>
        </div>
        {stats.daily && (
          <div className="mt-2 hidden items-center gap-2 sm:flex" title="Daily qualifying solves">
            <span className="hud-label !text-[0.6rem] !tracking-[0.12em]">Daily</span>
            <Pips filled={Math.min(stats.daily.qualifyingCount, stats.daily.cap)} total={stats.daily.cap} className="flex-1" />
            <span className="text-[0.66rem] font-bold tabular-nums text-slate-300">
              {stats.daily.qualifyingCount}/{stats.daily.cap}
            </span>
          </div>
        )}
      </div>
    </Link>
  );
}
