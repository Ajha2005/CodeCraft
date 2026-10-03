import { TIER_META } from '../../../lib/tiers';
import { Icon } from '../../../components/ui/Icon';
import { STATUS_COLOR, STATUS_LABEL, type ZoneSummary } from './zoneSummary';

export interface Splash {
  key: number;
  summary: ZoneSummary;
  progress: { found: number; total: number };
}

/** Top-center "where am I" pill: just the zone's name and a status dot. */
export function LocationChip({ summary }: { summary: ZoneSummary | null }) {
  if (!summary) {
    return (
      <div key="open" className="hud-panel hud-panel-quiet flex items-center gap-2 !rounded-full px-3.5 py-1.5 animate-slide-down">
        <Icon name="compass" className="h-3.5 w-3.5 text-slate-400" />
        <span className="text-[0.7rem] font-bold uppercase tracking-[0.16em] text-slate-300">Open ground</span>
      </div>
    );
  }

  const meta = TIER_META[summary.tier];
  return (
    <div
      key={summary.id}
      className="hud-panel hud-panel-quiet flex max-w-[min(20rem,calc(100vw-10.5rem))] sm:max-w-80 items-center gap-2.5 !rounded-full py-1.5 pl-3 pr-4 animate-slide-down"
      title={`${summary.name} · ${STATUS_LABEL[summary.status]}`}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill={meta.accent} aria-hidden="true">
        <path d={meta.icon} />
      </svg>
      <p className="font-display min-w-0 truncate text-[0.95rem] font-bold leading-none tracking-wide text-slate-50">{summary.name}</p>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: STATUS_COLOR[summary.status] }} />
      <span className="sr-only">{STATUS_LABEL[summary.status]}</span>
    </div>
  );
}

/** A brief title for a first-time discovery - the one moment worth a flourish. */
export function ZoneSplash({ splash }: { splash: Splash | null }) {
  if (!splash) return null;
  const meta = TIER_META[splash.summary.tier];
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[24%] z-20 flex justify-center px-4" aria-hidden="true">
      <div
        key={splash.key}
        className="px-16 py-6 text-center"
        style={{ animation: 'banner-sweep 2.2s ease-out both', background: 'radial-gradient(closest-side, rgba(3,8,14,0.72), rgba(3,8,14,0))' }}
      >
        <p className="font-display text-[0.7rem] font-bold uppercase tracking-[0.45em] text-amber-300 sm:text-xs">Zone discovered</p>
        <p
          className="font-display mt-1 text-3xl font-bold uppercase leading-none text-white sm:text-5xl"
          style={{ textShadow: `0 0 24px ${meta.accent}88, 0 3px 0 rgba(0,0,0,0.5)` }}
        >
          {splash.summary.name}
        </p>
        <p className="font-display mt-2.5 text-[0.7rem] font-bold uppercase tracking-[0.3em] sm:text-xs" style={{ color: meta.accent }}>
          {splash.progress.found}/{splash.progress.total} explored
        </p>
      </div>
    </div>
  );
}
