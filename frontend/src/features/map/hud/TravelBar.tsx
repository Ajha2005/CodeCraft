import { Icon } from '../../../components/ui/Icon';

interface TravelBarProps {
  target: string | null;
  meters: number | null;
  onCancel: () => void;
}

/** Shown while the commander auto-runs a route. */
export function TravelBar({ target, meters, onCancel }: TravelBarProps) {
  const eta = meters === null ? null : Math.max(1, Math.round((meters * 2) / 520));
  return (
    <div className="hud-panel hud-panel-quiet flex items-center gap-3 px-4 py-2.5 animate-slide-down" role="status">
      <span className="relative flex h-3 w-3">
        <span className="absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-70" style={{ animation: 'ping-ring 1.2s ease-out infinite' }} />
        <span className="relative inline-flex h-3 w-3 rounded-full bg-cyan-300" />
      </span>
      <div className="min-w-0">
        <p className="hud-label !text-[0.6rem] !text-cyan-300">En route</p>
        <p className="font-display truncate text-base font-bold leading-tight text-slate-50">{target ?? 'Selected point'}</p>
      </div>
      {meters !== null && (
        <p className="font-mono text-xs font-bold tabular-nums text-slate-300">
          {meters} m{eta !== null ? ` · ~${eta}s` : ''}
        </p>
      )}
      <button type="button" onClick={onCancel} className="btn-ghost ml-1 h-8 rounded-md px-2.5 text-xs font-semibold">
        <Icon name="x" className="h-3.5 w-3.5" /> Cancel <span className="keycap !h-5">Esc</span>
      </button>
    </div>
  );
}
