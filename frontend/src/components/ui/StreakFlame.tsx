import { useId } from 'react';
import { streakStage } from '../../lib/streak';

interface StreakFlameProps {
  /** Days in the current streak; picks how grown the flame is. */
  days: number;
  /** Rendered height in px (the flame is a little taller than wide). */
  size?: number;
  /** The streak is alive only thanks to yesterday: the flame sputters. */
  atRisk?: boolean;
  className?: string;
}

const OUTER = 'M24 2c2 9 14 15 14 31a14 14 0 0 1-28 0c0-6 3-10 6-13 0 5 2 8 5 9-1-9 1-19 3-27z';
const INNER = 'M24 26c1 5 7 8 7 14a7 7 0 0 1-14 0c0-3 1-5 3-7 0 2 1 4 3 4-1-4 0-8 1-11z';
const TONGUE_L = 'M9 24c-3 4-4 8-2 12 1 3 4 4 4 4-1-4 0-9 3-13-2 0-4-1-5-3z';
const TONGUE_R = 'M39 22c3 4 4 9 2 13-1 3-3 4-3 4 0-4-1-8-4-11 2 0 4-2 5-6z';

/**
 * The streak flame. It starts as an ember and, at 3, 7, 14 and 30 days, grows,
 * changes colour and picks up side tongues, sparks and a halo (see lib/streak).
 * With `atRisk` it flickers and dims, the "solve one today" warning.
 */
export function StreakFlame({ days, size = 40, atRisk = false, className }: StreakFlameProps) {
  const uid = useId().replace(/:/g, '');
  const stage = streakStage(days);
  const cold = days <= 0;
  const scale = 0.72 + stage.index * 0.07;
  const sparks = stage.index >= 2 ? (stage.index >= 4 ? 5 : 3) : 0;

  return (
    <span
      className={`relative inline-flex shrink-0 items-end justify-center ${className ?? ''}`}
      style={{ width: size * 0.75, height: size }}
      role="img"
      aria-label={`${days}-day streak, ${stage.name}${atRisk ? ', at risk' : ''}`}
    >
      {stage.index >= 1 && !cold && (
        <span
          className="pointer-events-none absolute inset-[-30%] rounded-full blur-md"
          style={{ background: `radial-gradient(circle, ${stage.glow}88, transparent 68%)`, opacity: atRisk ? 0.3 : 0.45 + stage.index * 0.1 }}
        />
      )}
      <svg
        viewBox="0 0 48 64"
        className={`relative h-full w-full origin-bottom overflow-visible ${cold ? '' : atRisk ? 'flame-risk' : 'flame-sway'}`}
        style={{ transform: `scale(${cold ? 0.7 : scale})`, filter: cold ? 'grayscale(1) opacity(.55)' : undefined }}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={`${uid}o`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={stage.outer[0]} />
            <stop offset="1" stopColor={stage.outer[1]} />
          </linearGradient>
          <linearGradient id={`${uid}i`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={stage.inner[0]} />
            <stop offset="1" stopColor={stage.inner[1]} />
          </linearGradient>
        </defs>
        {stage.index >= 1 && <path d={TONGUE_L} fill={`url(#${uid}o)`} opacity="0.85" className="flame-tongue" />}
        {stage.index >= 2 && <path d={TONGUE_R} fill={`url(#${uid}o)`} opacity="0.85" className="flame-tongue" style={{ animationDelay: '-0.4s' }} />}
        <path d={OUTER} fill={`url(#${uid}o)`} />
        <path d={INNER} fill={`url(#${uid}i)`} className="flame-core" />
        {Array.from({ length: sparks }, (_, i) => (
          <circle
            key={i}
            cx={14 + i * 7}
            cy={12}
            r={1.4 + (i % 2) * 0.5}
            fill={stage.inner[0]}
            className="flame-spark"
            style={{ animationDelay: `${-i * 0.55}s`, animationDuration: `${1.8 + (i % 3) * 0.4}s` }}
          />
        ))}
      </svg>
    </span>
  );
}
