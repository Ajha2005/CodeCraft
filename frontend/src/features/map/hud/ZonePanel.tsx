import { useState } from 'react';
import { Link } from 'react-router-dom';
import { TIER_META } from '../../../lib/tiers';
import { colorForUser } from '../../../lib/playerColor';
import { TierBadge } from '../../../components/ui/TierBadge';
import { Icon } from '../../../components/ui/Icon';
import { useAuth } from '../../../auth/AuthContext';
import { EMPTY_ZONE_TAP } from '../../../lib/flavorText';
import type { TerritoryDto } from '../../../types/territory';
import { TerritoryLeaderboard } from '../TerritoryLeaderboard';
import { useTerritoryLeaderboard } from '../hooks/useLeaderboard';
import { STATUS_COLOR, STATUS_LABEL, type ZoneSummary } from './zoneSummary';

export interface ZonePanelProps {
  summary: ZoneSummary;
  territory: TerritoryDto | null;
  distanceMeters: number | null;
  here: boolean;
  pinned: boolean;
  onTravel: () => void;
  onDive: () => void;
  onPin: () => void;
  onClose: () => void;
}

/** Inspect a zone: who holds it, how much, and what you can do about it. */
export function ZonePanel({ summary, territory, distanceMeters, here, pinned, onTravel, onDive, onPin, onClose }: ZonePanelProps) {
  const { user, flavorTextEnabled } = useAuth();
  const [showBoard, setShowBoard] = useState(false);
  const { entries } = useTerritoryLeaderboard(summary.territoryId);
  const meta = TIER_META[summary.tier];
  const names = new Map(entries.map((e) => [e.userId, e.name]));
  const pct = Math.round(summary.fraction * 100);
  const rivals = summary.shares.filter((s) => s.userId !== user?.userId);

  return (
    <div
      key={summary.id}
      className="hud-panel w-[min(24rem,calc(100vw-1rem))] p-3.5 animate-pop-in"
      style={{ borderColor: `${meta.accent}55` }}
      role="dialog"
      aria-label={`${summary.name} details`}
    >
      <div className="flex items-start gap-3">
        <div className="relative h-12 w-12 shrink-0">
          <div className="hex absolute inset-0" style={{ background: `linear-gradient(160deg, ${meta.accent}, ${meta.accent}55)` }} />
          <div className="hex absolute inset-[2px] flex items-center justify-center bg-slate-950">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill={meta.accent} style={{ filter: `drop-shadow(0 0 6px ${meta.accent})` }}>
              <path d={meta.icon} />
            </svg>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-display truncate text-2xl font-bold leading-none tracking-wide text-slate-50">{summary.name}</h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <TierBadge tier={summary.tier} />
            {distanceMeters !== null && !here && <span className="text-[0.7rem] font-semibold text-slate-400">{distanceMeters} m away</span>}
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-500 transition-colors hover:text-slate-100">
          <Icon name="x" className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 rounded-lg border border-slate-700/60 bg-slate-950/50 p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-[0.14em]" style={{ color: STATUS_COLOR[summary.status] }}>
            {STATUS_LABEL[summary.status]}
          </span>
          <span className="font-mono text-xs font-bold tabular-nums text-slate-300">
            {summary.owned}/{summary.total} cells · {pct}%
          </span>
        </div>
        <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-slate-800 ring-1 ring-slate-700/70">
          {summary.shares.map((s) => (
            <span
              key={s.userId}
              className="h-full transition-all duration-700"
              style={{ width: `${(s.cellCount / Math.max(1, summary.total)) * 100}%`, background: s.color, boxShadow: `0 0 10px ${s.color}88` }}
            />
          ))}
        </div>
        {summary.shares.length > 0 ? (
          <ul className="mt-2.5 grid grid-cols-1 gap-1">
            {summary.shares.slice(0, 3).map((s) => {
              const me = s.userId === user?.userId;
              const handle = me ? user?.username : s.username;
              const label = me ? 'You' : (s.username ?? names.get(s.userId) ?? 'Another commander');
              return (
                <li key={s.userId} className="flex items-center gap-2 text-xs">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color || colorForUser(s.userId) }} />
                  <span className="min-w-0 flex-1 truncate text-slate-200">
                    {handle ? (
                      <Link to={`/profile/${handle}`} className="transition-colors hover:text-cyan-200 hover:underline">
                        {label}
                      </Link>
                    ) : (
                      label
                    )}
                  </span>
                  <span className="font-mono font-bold tabular-nums text-slate-400">
                    {s.cellCount} · {Math.round((s.cellCount / Math.max(1, summary.total)) * 100)}%
                  </span>
                </li>
              );
            })}
            {summary.shares.length > 3 && <li className="text-[0.7rem] text-slate-500">+{summary.shares.length - 3} more</li>}
          </ul>
        ) : (
          <p className="mt-2 text-xs italic text-slate-500">{flavorTextEnabled ? EMPTY_ZONE_TAP : 'No one holds this zone yet.'}</p>
        )}
      </div>

      {rivals.length > 0 && (
        <p className="mt-2.5 flex items-center gap-2 text-xs leading-snug text-slate-400">
          <Icon name="swords" className="h-3.5 w-3.5 shrink-0 text-orange-300/90" />
          <span>Dive in, then click a rival’s cell to duel for it.</span>
        </p>
      )}

      <div className="mt-3 grid grid-cols-[1fr_auto_auto_auto] gap-2">
        <button type="button" onClick={onTravel} disabled={here} className="btn-primary h-10 whitespace-nowrap rounded-lg px-3 text-sm">
          <Icon name="arrowRight" className="h-4 w-4" />
          {here ? 'You’re here' : 'Travel'}
        </button>
        <button type="button" onClick={onDive} className="btn-ghost h-10 rounded-lg px-3 text-sm font-semibold" title="Zoom in on the cell grid (Space)">
          <Icon name="target" className="h-4 w-4" />
          <span className="hidden sm:inline">Dive in</span>
        </button>
        <button
          type="button"
          onClick={onPin}
          className={`btn-ghost h-10 w-10 rounded-lg ${pinned ? '!border-amber-400/70 !text-amber-300' : ''}`}
          aria-label={pinned ? 'Unpin waypoint' : 'Pin as waypoint'}
          title={pinned ? 'Unpin waypoint' : 'Pin as waypoint'}
        >
          <Icon name="pin" className="h-4 w-4" filled={pinned} />
        </button>
        <button
          type="button"
          onClick={() => setShowBoard((v) => !v)}
          className={`btn-ghost h-10 w-10 rounded-lg ${showBoard ? '!border-cyan-400/70 !text-cyan-300' : ''}`}
          aria-label="Toggle zone leaderboard"
          title="Zone leaderboard"
        >
          <Icon name="trophy" className="h-4 w-4" />
        </button>
      </div>

      {showBoard && (
        <div className="mt-3 max-h-48 overflow-y-auto pr-0.5">
          <TerritoryLeaderboard territory={territory} />
        </div>
      )}
    </div>
  );
}
