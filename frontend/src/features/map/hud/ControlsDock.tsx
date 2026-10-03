import type { ReactNode } from 'react';
import { Icon, type IconName } from '../../../components/ui/Icon';
import type { MapEngine } from '../world/engine';
import { useEngineStats } from './useEngineStats';
import { useSfxEnabled } from '../../../lib/useSfx';

interface DockButtonProps {
  icon: IconName;
  label: string;
  keycap?: string;
  onClick: () => void;
  active?: boolean;
  pulse?: boolean;
}

function DockButton({ icon, label, keycap, onClick, active, pulse }: DockButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`group relative flex h-10 w-10 items-center justify-center rounded-lg border transition-all hover:scale-105 active:scale-95 ${
        active
          ? 'border-cyan-400/70 bg-cyan-400/15 text-cyan-200'
          : 'border-slate-700/80 bg-slate-900/70 text-slate-300 hover:border-cyan-400/60 hover:text-cyan-200'
      } ${pulse ? 'animate-glow-pulse' : ''}`}
    >
      <Icon name={icon} className="h-[18px] w-[18px]" />
      <span className="pointer-events-none absolute right-full top-1/2 mr-2 hidden -translate-y-1/2 items-center gap-1.5 whitespace-nowrap rounded-md border border-slate-700 bg-slate-950/95 px-2 py-1 text-xs font-semibold text-slate-200 shadow-lg group-hover:flex group-focus-visible:flex sm:group-hover:flex">
        {label}
        {keycap && <span className="keycap">{keycap}</span>}
      </span>
    </button>
  );
}

/** Bottom-right camera controls. */
export function ControlsDock({ engine, children }: { engine: MapEngine; children?: ReactNode }) {
  const stats = useEngineStats(engine);
  const [soundOn, setSoundOn] = useSfxEnabled();

  return (
    <div className="hud-panel hud-panel-quiet flex flex-col items-center gap-1.5 p-1.5 animate-slide-in-right">
      <DockButton icon="plus" label="Zoom in" keycap="+" onClick={() => engine.zoomBy(1.35)} />
      <span className="font-mono text-[0.62rem] font-bold tabular-nums text-slate-400">{stats.zoomPct}%</span>
      <DockButton icon="minus" label="Zoom out" keycap="-" onClick={() => engine.zoomBy(1 / 1.35)} />
      <div className="my-0.5 h-px w-6 bg-slate-700/80" />
      <DockButton icon="locate" label="Recenter on commander" keycap="C" onClick={() => engine.recenter()} active={stats.following} pulse={!stats.following} />
      <DockButton icon="layers" label="Campus overview" keycap="O" onClick={() => engine.overview()} />
      <DockButton icon={soundOn ? 'volume' : 'mute'} label={soundOn ? 'Sound on' : 'Sound off'} onClick={() => setSoundOn(!soundOn)} active={soundOn} />
      {children}
    </div>
  );
}
