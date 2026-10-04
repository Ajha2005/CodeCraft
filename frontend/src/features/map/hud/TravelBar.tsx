import { Icon } from '../../../components/ui/Icon';

interface TravelBarProps {
  target: string | null;
  meters: number | null;
  onCancel: () => void;
}

/** Shown while the commander auto-runs a route. Esc (or the x) stops it. */
export function TravelBar({ target, meters, onCancel }: TravelBarProps) {
  return (
    <div className="hud-panel hud-panel-quiet flex items-center gap-2.5 !rounded-full py-1.5 pl-4 pr-1.5 animate-slide-down" role="status">
      <span className="h-2 w-2 shrink-0 rounded-full bg-cyan-300" />
      <p className="font-display min-w-0 truncate text-sm font-bold leading-none text-slate-50">{target ?? 'Selected point'}</p>
      {meters !== null && <p className="shrink-0 font-mono text-xs font-bold tabular-nums text-slate-400">{meters} m</p>}
      <button type="button" onClick={onCancel} aria-label="Cancel travel (Esc)" title="Cancel (Esc)" className="btn-ghost h-7 w-7 shrink-0 rounded-full">
        <Icon name="x" className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
