import { useRef } from 'react';
import type { MapEngine } from '../world/engine';

/** On-screen stick for touch devices. Pushing to the rim sprints. */
export function Joystick({ engine }: { engine: MapEngine }) {
  const baseRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const active = useRef<number | null>(null);

  function drive(e: React.PointerEvent) {
    const base = baseRef.current;
    const knob = knobRef.current;
    if (!base || !knob) return;
    const r = base.getBoundingClientRect();
    const radius = r.width / 2 - 14;
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy);
    if (d > radius) {
      dx = (dx / d) * radius;
      dy = (dy / d) * radius;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    engine.setVirtualStick(dx / radius, dy / radius, d > radius * 1.05);
  }

  function release() {
    active.current = null;
    if (knobRef.current) knobRef.current.style.transform = 'translate(0px, 0px)';
    engine.setVirtualStick(0, 0, false);
  }

  return (
    <div
      ref={baseRef}
      className="relative h-28 w-28 touch-none select-none rounded-full border border-cyan-400/40 bg-slate-950/55 backdrop-blur"
      style={{ boxShadow: '0 0 24px -6px rgba(34,211,238,0.45), inset 0 0 20px rgba(34,211,238,0.12)' }}
      onPointerDown={(e) => {
        active.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        drive(e);
      }}
      onPointerMove={(e) => {
        if (active.current === e.pointerId) drive(e);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      aria-label="Movement stick"
    >
      <div
        ref={knobRef}
        className="absolute left-1/2 top-1/2 -ml-6 -mt-6 h-12 w-12 rounded-full border border-cyan-300/70 bg-gradient-to-b from-cyan-300/60 to-cyan-600/50"
        style={{ boxShadow: '0 0 16px rgba(34,211,238,0.6)', transition: 'transform 0.06s linear' }}
      />
    </div>
  );
}
