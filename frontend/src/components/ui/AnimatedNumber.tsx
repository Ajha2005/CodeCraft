import { useAnimatedNumber } from '../../lib/useAnimatedNumber';

interface AnimatedNumberProps {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
  className?: string;
}

export function AnimatedNumber({ value, decimals = 0, prefix = '', suffix = '', duration = 900, className }: AnimatedNumberProps) {
  const shown = useAnimatedNumber(value, duration);
  const text = decimals > 0 ? shown.toFixed(decimals) : Math.round(shown).toLocaleString('en-US');
  return (
    <span className={`tabular-nums ${className ?? ''}`}>
      {prefix}
      {text}
      {suffix}
    </span>
  );
}
