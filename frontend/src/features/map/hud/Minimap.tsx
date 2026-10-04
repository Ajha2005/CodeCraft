import { useEffect, useRef } from 'react';
import type { MapEngine } from '../world/engine';

/** Bottom-left minimap: click anywhere to send your commander there. */
export function Minimap({ engine }: { engine: MapEngine }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    engine.setMinimap(canvasRef.current);
    return () => engine.setMinimap(null);
  }, [engine]);

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const p = engine.minimapToWorld(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
    if (p) engine.travelToPoint(p.x, p.y);
  }

  return (
    <div className="hud-panel hud-panel-quiet w-[12.5rem] p-1.5 animate-slide-in-left max-sm:w-[8.5rem] max-sm:p-1">
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        className="block h-[6.6rem] w-full cursor-crosshair rounded-lg max-sm:h-[4.2rem]"
        aria-label="Campus minimap. Click to travel."
      />
    </div>
  );
}
