interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  className?: string;
}

/** Tiny area chart; no axes, because the surrounding label says what it means. */
export function Sparkline({ values, width = 240, height = 56, color = '#22d3ee', className }: SparklineProps) {
  if (values.length < 2) {
    return <div className={className} style={{ width, height }} />;
  }
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pad = 4;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (width - pad * 2);
    const y = height - pad - ((v - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });
  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)} ${height} L${pts[0][0].toFixed(1)} ${height} Z`;
  const id = `spark-${color.replace('#', '')}`;
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.4" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
      <circle cx={lx} cy={ly} r="3.5" fill="#04101a" stroke={color} strokeWidth="2" />
    </svg>
  );
}
