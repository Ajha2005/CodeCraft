import { Icon } from '../../../components/ui/Icon';
import { toMeters, type World } from '../world/campus';
import type { MapEngine } from '../world/engine';
import { useEngineStats } from './useEngineStats';
import { TravelBar } from './TravelBar';
import { ZonePanel, type ZonePanelProps } from './ZonePanel';

// Thin wrappers that subscribe to the engine's ~10 Hz stats themselves, so the
// page above them does not re-render on every step the commander takes.

export function ZonePanelLive({ engine, world, ...props }: Omit<ZonePanelProps, 'distanceMeters'> & { engine: MapEngine; world: World }) {
  const stats = useEngineStats(engine);
  const zone = world.campus.byId.get(props.summary.id);
  const distance = zone ? toMeters(Math.hypot(zone.anchor.x - stats.px, zone.anchor.y - stats.py)) : null;
  return <ZonePanel {...props} distanceMeters={distance} />;
}

export function TravelBarLive({ engine, target }: { engine: MapEngine; target: string | null }) {
  const stats = useEngineStats(engine);
  return <TravelBar target={target} meters={stats.destinationMeters} onCancel={() => engine.cancelTravel()} />;
}

export function WaypointChip({ engine, name, onGo, onClear }: { engine: MapEngine; name: string; onGo: () => void; onClear: () => void }) {
  const stats = useEngineStats(engine);
  return (
    <div className="hud-panel hud-panel-quiet pointer-events-auto flex items-center gap-2 px-3 py-1.5 text-xs animate-slide-down">
      <Icon name="pin" filled className="h-3.5 w-3.5 text-amber-300" />
      <span className="font-semibold text-slate-200">{name}</span>
      <span className="font-mono font-bold text-amber-300">{stats.waypointMeters ?? 0} m</span>
      <button type="button" onClick={onGo} className="btn-ghost h-6 rounded px-2 text-[0.68rem] font-bold">
        Go
      </button>
      <button type="button" onClick={onClear} aria-label="Unpin waypoint" className="text-slate-500 hover:text-slate-200">
        <Icon name="x" className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
