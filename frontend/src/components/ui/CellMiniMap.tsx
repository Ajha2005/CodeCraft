import { useMemo } from 'react';
import type { TerritoryCellDto } from '../../lib/api';
import { cellOwnerColor } from '../../lib/playerColor';

interface CellMiniMapProps {
  /** Every cell of the zone, so the picture is the real shape of the zone. */
  cells: TerritoryCellDto[];
  /** The cell to point out. */
  highlight?: { row: number; col: number } | null;
  /** Colour of the highlighted cell (its owner's colour). */
  highlightColor?: string;
  /** Widest the picture may be, in px; cells shrink to fit. */
  maxWidth?: number;
  /** Largest a single cell may be, in px. */
  maxCell?: number;
  className?: string;
  label?: string;
}

/**
 * A small picture of one zone's cell grid with one cell lit up: the answer to
 * "which cell did I just win?". Held cells show their owner's colour, free
 * ground stays dark, and spaces outside the zone's outline stay empty.
 */
export function CellMiniMap({ cells, highlight = null, highlightColor = '#22d3ee', maxWidth = 180, maxCell = 26, className, label }: CellMiniMapProps) {
  const layout = useMemo(() => {
    if (cells.length === 0) return null;
    let maxRow = 0;
    let maxCol = 0;
    const byPos = new Map<number, TerritoryCellDto>();
    for (const c of cells) {
      maxRow = Math.max(maxRow, c.row);
      maxCol = Math.max(maxCol, c.col);
      byPos.set(c.row * 1000 + c.col, c);
    }
    return { rows: maxRow + 1, cols: maxCol + 1, byPos };
  }, [cells]);

  if (!layout) return null;

  const gap = 2;
  const cell = Math.max(8, Math.min(maxCell, Math.floor((maxWidth - gap * (layout.cols - 1)) / layout.cols)));

  return (
    <div
      className={`inline-grid rounded-lg border border-slate-700/70 bg-slate-950/70 p-2 ${className ?? ''}`}
      style={{ gridTemplateColumns: `repeat(${layout.cols}, ${cell}px)`, gap }}
      role="img"
      aria-label={label ?? (highlight ? `Cell at row ${highlight.row + 1}, column ${highlight.col + 1} highlighted` : 'Zone cells')}
    >
      {Array.from({ length: layout.rows * layout.cols }, (_, i) => {
        const row = Math.floor(i / layout.cols);
        const col = i % layout.cols;
        const c = layout.byPos.get(row * 1000 + col);
        if (!c) return <span key={i} style={{ width: cell, height: cell }} />;
        const lit = highlight?.row === row && highlight?.col === col;
        const owned = !!c.ownerId;
        return (
          <span
            key={i}
            className={`rounded-[3px] ${lit ? 'cell-lit' : ''}`}
            style={{
              width: cell,
              height: cell,
              background: lit ? highlightColor : owned ? cellOwnerColor(c.ownerId, c.ownerColor) : '#1e2733',
              opacity: lit ? 1 : owned ? 0.55 : 1,
              ['--lit' as string]: highlightColor,
            }}
          />
        );
      })}
    </div>
  );
}
