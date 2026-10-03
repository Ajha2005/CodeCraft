import { useEffect, useRef } from 'react';
import type { MapEngine } from '../world/engine';
import { useEngineStats } from './useEngineStats';

/** Bottom-left minimap: click anywhere to send your commander there. */
export function Minimap({ engine }: { engine: MapEngine }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stats = useEngineStats(engine);

  useEffect(() => {
    engine.setMinimap(canvasRef.current);
    return () => engine.setMinimap(null);
  }, [engine]);

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const p = engine.minimapToWorld(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
    if (p) engine.travelToPoint(p.x, p.y);
  }

  const deg = (stats.heading * 180) / Math.PI;

  return (
    <div className="hud-panel w-[14.5rem] max-w-[46vw] p-2 animate-slide-in-left">
      <div className="relative overflow-hidden rounded-lg ring-1 ring-cyan-500/20">
        <canvas
          ref={canvasRef}
          onClick={handleClick}
          className="block h-[7.6rem] w-full cursor-crosshair"
          aria-label="Campus minimap. Click to travel."
        />
        <div className="pointer-events-none absolute left-1.5 top-1.5 flex items-center gap-1 rounded bg-black/55 px-1.5 py-0.5">
          <span className="hud-label !text-[0.55rem] !tracking-[0.14em] !text-cyan-300">Radar</span>
        </div>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 px-0.5 font-mono text-[0.66rem] font-bold">
        <span className="rounded bg-cyan-500/15 px-1.5 py-0.5 text-cyan-300">SEC {stats.sector}</span>
        <span className="tabular-nums text-slate-400">
          {Math.round(stats.px / 2)}, {Math.round(stats.py / 2)}
        </span>
        <span
          className="flex h-5 w-5 items-center justify-center rounded-full border border-slate-600 bg-slate-900/80"
          title="Heading"
        >
          <svg viewBox="0 0 24 24" className="h-3 w-3 text-cyan-300 transition-transform duration-150" style={{ transform: `rotate(${deg}deg)` }} fill="currentColor">
            <path d="M20 12 5 5l3 7-3 7z" />
          </svg>
        </span>
      </div>
    </div>
  );
}
