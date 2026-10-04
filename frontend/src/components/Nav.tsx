import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { usePlayerStats } from '../lib/playerStatsContext';
import { useIncomingChallenges } from '../lib/useIncomingChallenges';
import { useSfxEnabled } from '../lib/useSfx';
import { sfx } from '../lib/sfx';
import { rankTitle } from '../lib/flavorText';
import { Icon, type IconName } from './ui/Icon';
import { LevelBadge } from './ui/LevelBadge';
import { XPBar } from './ui/XPBar';

const NAV_LINKS: { to: string; label: string; icon: IconName; match: (p: string) => boolean }[] = [
  { to: '/', label: 'Problems', icon: 'code', match: (p) => p === '/' },
  { to: '/scoring', label: 'Scoring', icon: 'chart', match: (p) => p === '/scoring' },
  { to: '/map', label: 'Map', icon: 'map', match: (p) => p === '/map' },
  { to: '/contests', label: 'Contests', icon: 'swords', match: (p) => p === '/contests' || p.startsWith('/contest/') },
];

function IconToggle({ on, onClick, label, icon }: { on: boolean; onClick: () => void; label: string; icon: IconName }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={on}
      title={label}
      className={`flex h-9 w-9 items-center justify-center rounded-lg border transition-all hover:scale-105 active:scale-95 ${
        on ? 'border-cyan-400/60 bg-cyan-400/10 text-cyan-200' : 'border-slate-700/80 text-slate-400 hover:border-slate-500 hover:text-slate-200'
      }`}
    >
      <Icon name={icon} className="h-[17px] w-[17px]" />
    </button>
  );
}

export function Nav() {
  const { pathname } = useLocation();
  const { user, logout, flavorTextEnabled, setFlavorTextEnabled } = useAuth();
  const { stats } = usePlayerStats();
  const [soundOn, setSoundOn] = useSfxEnabled();
  const incoming = useIncomingChallenges(!!user);
  const name = user?.username || 'Commander';

  return (
    <>
      <nav
        className="sticky top-0 z-40 flex shrink-0 items-center justify-between gap-3 border-b border-slate-800/80 bg-slate-950/85 px-3 backdrop-blur-xl sm:gap-6 sm:px-6 md:px-8"
        style={{ height: 'var(--nav-h)' }}
      >
        <div className="flex min-w-0 items-center gap-6 md:gap-10">
          <Link to="/" className="font-display flex shrink-0 select-none items-center gap-2 text-xl font-bold tracking-wide">
            <span className="relative flex h-7 w-7 items-center justify-center">
              <span className="hex absolute inset-0 bg-gradient-to-b from-cyan-300 to-teal-500 opacity-90" />
              <span className="hex absolute inset-[2px] bg-slate-950" />
              <Icon name="flag" filled className="relative h-3 w-3 text-cyan-300" />
            </span>
            <span>
              <span className="text-slate-100">Code</span>
              <span className="bg-gradient-to-r from-cyan-400 via-teal-300 to-cyan-300 bg-clip-text text-transparent drop-shadow-[0_0_10px_rgba(34,211,238,0.45)]">
                Craft
              </span>
            </span>
          </Link>

          <div className="hidden items-center gap-1 sm:flex">
            {NAV_LINKS.map((link) => {
              const active = link.match(pathname);
              const badge = link.to === '/contests' && incoming > 0;
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  onClick={() => sfx.play('click')}
                  className={`group relative flex items-center gap-2 rounded-lg px-3.5 py-2 text-[0.8rem] font-bold uppercase tracking-[0.14em] transition-all ${
                    active ? 'bg-cyan-400/10 text-cyan-300' : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-100'
                  }`}
                >
                  <Icon name={link.icon} className={`h-4 w-4 transition-transform group-hover:scale-110 ${active ? 'drop-shadow-[0_0_6px_rgba(34,211,238,0.8)]' : ''}`} />
                  {link.label}
                  {badge && (
                    <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[0.62rem] font-bold text-white shadow-[0_0_10px_rgba(244,63,94,0.8)] animate-glow-pulse">
                      {incoming}
                    </span>
                  )}
                  <span
                    className={`absolute inset-x-3 -bottom-[11px] h-[2px] rounded-full bg-gradient-to-r from-transparent via-cyan-300 to-transparent transition-all ${
                      active ? 'opacity-100 shadow-[0_0_10px_rgba(34,211,238,0.9)]' : 'scale-x-0 opacity-0 group-hover:scale-x-100 group-hover:opacity-60'
                    }`}
                  />
                </Link>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/scoring"
            className="group hidden items-center gap-2.5 rounded-xl border border-slate-700/70 bg-slate-900/60 py-1 pl-1.5 pr-3 transition-colors hover:border-cyan-400/50 md:flex"
            title="Your campaign report"
          >
            <LevelBadge level={stats.level.level} size={34} />
            <span className="min-w-0 leading-tight">
              <span className="block max-w-[8.5rem] truncate text-[0.82rem] font-semibold text-slate-100">{name}</span>
              <span className="mt-0.5 flex items-center gap-1.5">
                <XPBar pct={stats.level.pct} className="!h-1 w-16" />
                <span className="font-display text-[0.62rem] font-bold uppercase tracking-wide text-amber-300/90">
                  {stats.rank ? (flavorTextEnabled ? rankTitle(stats.rank) : `Rank #${stats.rank}`) : `LV ${stats.level.level}`}
                </span>
              </span>
            </span>
          </Link>
          <Link to="/scoring" className="md:hidden" aria-label="Your campaign report">
            <LevelBadge level={stats.level.level} size={36} />
          </Link>

          <IconToggle on={soundOn} onClick={() => setSoundOn(!soundOn)} label={soundOn ? 'Sound on' : 'Sound off'} icon={soundOn ? 'volume' : 'mute'} />
          <IconToggle
            on={flavorTextEnabled}
            onClick={() => setFlavorTextEnabled(!flavorTextEnabled)}
            label={flavorTextEnabled ? 'Flavor text on' : 'Flavor text off'}
            icon="sparkles"
          />
          <button
            type="button"
            onClick={logout}
            aria-label="Log out"
            title="Log out"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700/80 text-slate-400 transition-all hover:scale-105 hover:border-rose-400/60 hover:text-rose-300 active:scale-95"
          >
            <Icon name="logout" className="h-[17px] w-[17px]" />
          </button>
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-cyan-500/40 to-transparent" />
      </nav>

      {/* phone tab bar */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-slate-800/80 bg-slate-950/92 backdrop-blur-xl sm:hidden"
        style={{ height: 'var(--tabbar-h)', paddingBottom: 'env(safe-area-inset-bottom)' }}
        aria-label="Primary"
      >
        {NAV_LINKS.map((link) => {
          const active = link.match(pathname);
          const badge = link.to === '/contests' && incoming > 0;
          return (
            <Link
              key={link.to}
              to={link.to}
              className={`relative flex flex-col items-center justify-center gap-0.5 text-[0.62rem] font-bold uppercase tracking-[0.12em] transition-colors ${
                active ? 'text-cyan-300' : 'text-slate-500'
              }`}
            >
              {active && <span className="absolute inset-x-6 top-0 h-[2px] rounded-full bg-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.9)]" />}
              <span className="relative">
                <Icon name={link.icon} className={`h-5 w-5 ${active ? 'drop-shadow-[0_0_6px_rgba(34,211,238,0.8)]' : ''}`} />
                {badge && <span className="absolute -right-1.5 -top-1 h-2.5 w-2.5 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.9)]" />}
              </span>
              {link.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
