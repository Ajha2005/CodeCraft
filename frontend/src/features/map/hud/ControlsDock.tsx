import { Icon, type IconName } from '../../../components/ui/Icon';
import type { MapEngine } from '../world/engine';
import { useEngineSelector } from './useEngineStats';

interface DockButtonProps {
  icon: IconName;
  label: string;
  keycap?: string;
  onClick: () => void;
  active?: boolean;
}

function DockButton({ icon, label, keycap, onClick, active }: DockButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`group relative flex h-9 w-9 items-center justify-center rounded-lg border transition-colors ${
        active
          ? 'border-cyan-400/60 bg-cyan-400/10 text-cyan-200'
          : 'border-transparent text-slate-300 hover:border-cyan-400/50 hover:text-cyan-200'
      }`}
    >
      <Icon name={icon} className="h-[18px] w-[18px]" />
      <span className="pointer-events-none absolute right-full top-1/2 mr-2 hidden -translate-y-1/2 items-center gap-1.5 whitespace-nowrap rounded-md border border-slate-700 bg-slate-950/95 px-2 py-1 text-xs font-semibold text-slate-200 shadow-lg group-hover:flex group-focus-visible:flex">
        {label}
        {keycap && <span className="keycap">{keycap}</span>}
      </span>
    </button>
  );
}

/** Bottom-right camera controls: zoom, recenter, overview. */
export function ControlsDock({ engine }: { engine: MapEngine }) {
  const following = useEngineSelector(engine, (s) => s.following);

  return (
    <div className="hud-panel hud-panel-quiet flex flex-col items-center gap-0.5 p-1 animate-slide-in-right">
      <DockButton icon="plus" label="Zoom in" keycap="+" onClick={() => engine.zoomBy(1.35)} />
      <DockButton icon="minus" label="Zoom out" keycap="-" onClick={() => engine.zoomBy(1 / 1.35)} />
      <div className="my-0.5 h-px w-5 bg-slate-700/70" />
      {/* lights up only when you have wandered off and the camera is no longer on you */}
      <DockButton icon="locate" label="Recenter on commander" keycap="C" onClick={() => engine.recenter()} active={!following} />
      <DockButton icon="layers" label="Campus overview" keycap="O" onClick={() => engine.overview()} />
    </div>
  );
}
