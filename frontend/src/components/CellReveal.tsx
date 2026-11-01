import { Link } from 'react-router-dom';
import type { AwardedCell } from '../features/problems/api';
import { useTerritoryCells } from '../features/map/hooks/useTerritoryCells';
import { TIER_META, tierOf } from '../lib/tiers';
import { CellMiniMap } from './ui/CellMiniMap';
import { Icon } from './ui/Icon';
import { TierBadge } from './ui/TierBadge';

interface CellRevealProps {
  /** The cell the solve won; null when nothing was left to take. */
  cell: AwardedCell | null;
  /** The player's colour: the lit cell is drawn in it. */
  color: string;
  flavor?: boolean;
}

/**
 * "You solved it - and this is the cell you won." A picture of the zone with the
 * cell lit up, its place in words (zone, row, column) and a link to see it on the
 * map. Shown right under the verdict of an accepted solve.
 */
export function CellReveal({ cell, color, flavor = true }: CellRevealProps) {
  if (!cell) {
    return (
      <p className="mt-3 flex items-start gap-2 border-t border-white/10 pt-3 text-sm text-slate-400">
        <Icon name="lock" className="mt-0.5 h-4 w-4 shrink-0" />
        No cell could be awarded this time — every cell of this tier is held or tied up in a duel.
      </p>
    );
  }
  return <RevealBody cell={cell} color={color} flavor={flavor} />;
}

function RevealBody({ cell, color, flavor }: { cell: AwardedCell; color: string; flavor: boolean }) {
  const { cellsByTerritory } = useTerritoryCells();
  const zoneCells = cellsByTerritory[cell.territoryId] ?? [];
  const meta = TIER_META[tierOf(cell.tier)];

  return (
    <div className="mt-4 flex items-center gap-4 border-t border-white/10 pt-4 animate-fade-in-up">
      {zoneCells.length > 0 ? (
        <CellMiniMap cells={zoneCells} highlight={{ row: cell.row, col: cell.col }} highlightColor={color} maxWidth={132} maxCell={22} />
      ) : (
        <span className="h-20 w-20 shrink-0 animate-pulse rounded-lg bg-slate-800/60" />
      )}
      <div className="min-w-0 flex-1">
        <p className="hud-label !text-[0.64rem]" style={{ color }}>
          {cell.captured ? (flavor ? 'Cell captured from a rival' : 'Cell captured') : flavor ? 'New cell claimed' : 'Cell awarded'}
        </p>
        <p className="font-display truncate text-2xl font-bold leading-tight tracking-wide text-slate-50">{cell.territoryName}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-400">
          <TierBadge tier={cell.tier} />
          <span className="font-mono font-bold tabular-nums text-slate-300">
            Row {cell.row + 1} · Col {cell.col + 1}
          </span>
        </div>
        <p className="mt-1.5 text-xs text-slate-500">{meta.blurb}</p>
        <Link to={`/map?territory=${cell.territoryId}`} className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-cyan-300 hover:text-cyan-200">
          See it on the map <Icon name="arrowRight" className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}
