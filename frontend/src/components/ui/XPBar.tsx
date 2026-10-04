interface XPBarProps {
  pct: number;
  tone?: 'gold' | 'cyan';
  className?: string;
  height?: number;
}

export function XPBar({ pct, tone = 'gold', className, height }: XPBarProps) {
  const w = Math.max(0, Math.min(100, pct * 100));
  return (
    <div
      className={`xp-track ${className ?? ''}`}
      style={height ? { height } : undefined}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(w)}
    >
      <div className={`xp-fill ${tone === 'cyan' ? 'xp-fill-cyan' : ''}`} style={{ width: `${w}%` }} />
    </div>
  );
}
