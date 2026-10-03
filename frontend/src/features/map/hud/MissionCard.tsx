import { Link } from 'react-router-dom';
import { useAuth } from '../../../auth/AuthContext';
import { usePlayerStats } from '../../../lib/playerStatsContext';
import { Icon } from '../../../components/ui/Icon';

/**
 * Closes the loop from the map back to the core mechanic: territory is earned
 * by solving problems. New players get a first mission; everyone else is
 * nudged while they still have daily solves left.
 */
export function MissionCard() {
  const { flavorTextEnabled } = useAuth();
  const { stats } = usePlayerStats();
  if (!stats.loaded) return null;

  const first = stats.solves === 0;
  const left = stats.daily ? Math.max(0, stats.daily.cap - stats.daily.qualifyingCount) : 0;
  if (!first && left === 0) return null;

  const title = first ? 'First mission' : 'Daily quest';
  const body = first
    ? flavorTextEnabled
      ? 'Solve any problem to plant your first flag on campus.'
      : 'Solve a problem to earn score and your first cell.'
    : `${left} more ${left === 1 ? 'solve' : 'solves'} today will earn territory.`;

  return (
    <Link
      to="/"
      className="hud-panel group flex w-[19.5rem] items-center gap-3 p-3 animate-slide-in-left transition-colors hover:border-amber-300/60"
      style={{ borderColor: 'rgba(251,191,36,0.3)' }}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-300/50 bg-amber-300/10 text-amber-300">
        <Icon name={first ? 'flag' : 'bolt'} filled className="h-5 w-5 animate-float" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="hud-label !text-[0.6rem] !text-amber-300">{title}</span>
        <span className="mt-0.5 block text-[0.8rem] leading-snug text-slate-200">{body}</span>
      </span>
      <Icon name="arrowRight" className="h-4 w-4 shrink-0 text-amber-300 transition-transform group-hover:translate-x-1" />
    </Link>
  );
}
