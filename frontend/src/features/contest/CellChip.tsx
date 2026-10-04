import { Icon } from '../../components/ui/Icon';
import { TIER_META, tierOf } from '../../lib/tiers';
import { cellText } from './cellText';
import type { ContestCellSummary } from './types';

/** A cell on the line in a duel, tinted by its tier. */
export function CellChip({ cell, className = '' }: { cell: ContestCellSummary; className?: string }) {
  const accent = TIER_META[tierOf(cell.tier)].accent;
  return (
    <span className={`inline-flex min-w-0 max-w-full items-center gap-1.5 text-xs font-semibold text-slate-300 ${className}`} title={cellText(cell)}>
      <Icon name="flag" filled className="h-3 w-3 shrink-0" style={{ color: accent }} />
      <span className="truncate">{cellText(cell)}</span>
    </span>
  );
}
