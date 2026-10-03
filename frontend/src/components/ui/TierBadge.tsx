import { TIER_META, tierOf } from '../../lib/tiers';

interface TierBadgeProps {
  tier: string;
  size?: 'sm' | 'md';
  className?: string;
}

export function TierBadge({ tier, size = 'sm', className }: TierBadgeProps) {
  const meta = TIER_META[tierOf(tier)];
  const small = size === 'sm';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border font-display font-bold uppercase ${
        small ? 'px-1.5 py-0.5 text-[10px] tracking-[0.12em]' : 'px-2.5 py-1 text-xs tracking-[0.14em]'
      } ${className ?? ''}`}
      style={{ color: meta.accent, borderColor: `${meta.accent}66`, background: `${meta.accent}1a` }}
    >
      <svg viewBox="0 0 24 24" width={small ? 11 : 14} height={small ? 11 : 14} fill="currentColor" aria-hidden="true">
        <path d={meta.icon} />
      </svg>
      {meta.label}
    </span>
  );
}
