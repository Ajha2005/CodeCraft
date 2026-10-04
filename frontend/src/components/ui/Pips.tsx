interface PipsProps {
  filled: number;
  total: number;
  color?: string;
  className?: string;
}

/** Segmented meter: handy for "3 of 6 daily solves". */
export function Pips({ filled, total, color = '#22d3ee', className }: PipsProps) {
  return (
    <div className={`flex gap-1.5 ${className ?? ''}`} role="img" aria-label={`${filled} of ${total}`}>
      {Array.from({ length: total }, (_, i) => {
        const on = i < filled;
        return (
          <span
            key={i}
            className="h-2 flex-1 rounded-sm transition-all duration-500"
            style={{
              transitionDelay: `${i * 60}ms`,
              background: on ? color : 'rgba(51,65,85,0.55)',
              boxShadow: on ? `0 0 10px ${color}99` : undefined,
              transform: on ? 'skewX(-18deg)' : 'skewX(-18deg) scaleY(0.7)',
            }}
          />
        );
      })}
    </div>
  );
}
