import { useEffect, useRef } from 'react';
import { STATUS_COLOR, STATUS_LABEL, type ZoneSummary } from './zoneSummary';

interface HoverTooltipProps {
  summary: ZoneSummary;
  /** Position where the hover began, so the first paint is already correct. */
  x: number;
  y: number;
  cellNote: string | null;
}

/** Follows the pointer by writing the transform directly - no re-render per move. */
export function HoverTooltip({ summary, x, y, cellNote }: HoverTooltipProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const place = (cx: number, cy: number) => {
      const el = ref.current;
      if (!el) return;
      const px = Math.min(cx + 18, window.innerWidth - el.offsetWidth - 8);
      const py = Math.min(cy + 20, window.innerHeight - el.offsetHeight - 8);
      el.style.transform = `translate(${Math.max(8, px)}px, ${Math.max(8, py)}px)`;
    };
    place(x, y);
    const move = (e: PointerEvent) => place(e.clientX, e.clientY);
    window.addEventListener('pointermove', move);
    return () => window.removeEventListener('pointermove', move);
  }, [x, y]);

  return (
    <div
      ref={ref}
      className="hud-panel hud-panel-quiet pointer-events-none fixed left-0 top-0 z-40 w-max min-w-[9rem] max-w-[16rem] !rounded-lg px-3 py-2"
      style={{ transform: `translate(${x + 18}px, ${y + 20}px)` }}
    >
      <p className="font-display truncate text-[0.95rem] font-bold leading-tight text-slate-50">{summary.name}</p>
      <p className="mt-0.5 text-[0.68rem] font-bold uppercase tracking-wide" style={{ color: STATUS_COLOR[summary.status] }}>
        {STATUS_LABEL[summary.status]}
        <span className="ml-1.5 font-mono font-semibold text-slate-400">
          {summary.owned}/{summary.total}
        </span>
      </p>
      {cellNote && <p className="mt-1 text-xs font-semibold text-orange-300">{cellNote}</p>}
    </div>
  );
}
