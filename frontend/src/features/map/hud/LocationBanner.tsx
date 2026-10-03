import { TIER_META } from '../../../lib/tiers';
import { TierBadge } from '../../../components/ui/TierBadge';
import { Icon } from '../../../components/ui/Icon';
import { STATUS_COLOR, STATUS_LABEL, type ZoneSummary } from './zoneSummary';

export interface Splash {
  key: number;
  kind: 'enter' | 'discover';
  summary: ZoneSummary;
  progress?: { found: number; total: number };
}

/** Top-center "where am I" chip: zone, tier, who holds it, control meter. */
export function LocationChip({ summary, sector }: { summary: ZoneSummary | null; sector: string }) {
  if (!summary) {
    return (
      <div className="hud-panel hud-panel-quiet flex items-center gap-2.5 px-4 py-2 animate-slide-down" key="open">
        <Icon name="compass" className="h-4 w-4 text-slate-400" />
        <span className="hud-label !text-slate-300">Open ground</span>
        <span className="font-mono text-[0.7rem] font-bold text-cyan-300/80">SECTOR {sector}</span>
      </div>
    );
  }

  const meta = TIER_META[summary.tier];
  return (
    <div key={summary.id} className="hud-panel hud-panel-quiet w-[min(26rem,calc(100vw-1.5rem))] px-4 py-2.5 animate-slide-down">
      <div className="flex items-center gap-2.5">
        <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill={meta.accent} style={{ filter: `drop-shadow(0 0 6px ${meta.accent})` }}>
          <path d={meta.icon} />
        </svg>
        <p className="font-display min-w-0 flex-1 truncate text-lg font-bold leading-none tracking-wide text-slate-50">{summary.name}</p>
        <TierBadge tier={summary.tier} />
        <span className="font-mono text-[0.68rem] font-bold text-cyan-300/80">{sector}</span>
      </div>
      <div className="mt-2 flex items-center gap-2.5">
        <div className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800/90 ring-1 ring-slate-700/60">
          {summary.shares.map((s) => (
            <span key={s.userId} style={{ width: `${(s.cellCount / Math.max(1, summary.total)) * 100}%`, background: s.color }} />
          ))}
        </div>
        <span className="text-[0.68rem] font-bold uppercase tracking-wide" style={{ color: STATUS_COLOR[summary.status] }}>
          {STATUS_LABEL[summary.status]}
        </span>
      </div>
    </div>
  );
}

/** Big cinematic title when you walk into a zone (or discover it). */
export function ZoneSplash({ splash }: { splash: Splash | null }) {
  if (!splash) return null;
  const meta = TIER_META[splash.summary.tier];
  const discover = splash.kind === 'discover';
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[22%] z-20 flex justify-center px-4" aria-hidden="true">
      <div key={splash.key} className="text-center" style={{ animation: 'banner-sweep 2.6s ease-out both' }}>
        <p className="font-display text-xs font-bold uppercase tracking-[0.5em] sm:text-sm" style={{ color: discover ? '#fbbf24' : meta.accent }}>
          {discover ? '✦ Zone discovered ✦' : 'Entering'}
        </p>
        <p
          className="font-display mt-1 text-4xl font-bold uppercase leading-none text-white sm:text-6xl"
          style={{ textShadow: `0 0 28px ${meta.accent}aa, 0 3px 0 rgba(0,0,0,0.5)` }}
        >
          {splash.summary.name}
        </p>
        <div className="mx-auto mt-3 flex items-center justify-center gap-3">
          <span className="h-px w-16 bg-gradient-to-r from-transparent" style={{ backgroundImage: `linear-gradient(90deg, transparent, ${meta.accent})` }} />
          <span className="font-display text-xs font-bold uppercase tracking-[0.3em] sm:text-sm" style={{ color: meta.accent }}>
            {meta.label}
            {discover && splash.progress ? ` · ${splash.progress.found}/${splash.progress.total} explored` : ''}
          </span>
          <span className="h-px w-16" style={{ backgroundImage: `linear-gradient(90deg, ${meta.accent}, transparent)` }} />
        </div>
      </div>
    </div>
  );
}
