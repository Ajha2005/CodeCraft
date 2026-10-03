interface LevelBadgeProps {
  level: number;
  size?: number;
  className?: string;
}

/** Hexagonal level medallion. Gold rim, dark core, the number in display type. */
export function LevelBadge({ level, size = 44, className }: LevelBadgeProps) {
  return (
    <div
      className={`relative shrink-0 ${className ?? ''}`}
      style={{ width: size, height: size, filter: 'drop-shadow(0 0 8px rgba(251,191,36,0.45))' }}
      aria-label={`Level ${level}`}
    >
      <div className="hex absolute inset-0 bg-gradient-to-b from-amber-200 via-amber-400 to-amber-600" />
      <div className="hex absolute bg-gradient-to-b from-slate-800 to-slate-950" style={{ inset: Math.max(2, size * 0.055) }} />
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="font-display text-amber-300/80 font-bold" style={{ fontSize: size * 0.2, letterSpacing: '0.1em' }}>
          LV
        </span>
        <span className="font-display font-bold text-amber-100" style={{ fontSize: size * (level >= 100 ? 0.3 : 0.42) }}>
          {level}
        </span>
      </div>
    </div>
  );
}
