import type { ContestCellSummary } from './types';

/** "Main Gate · R3 · C2" - which cell, in words. */
export function cellText(cell: ContestCellSummary): string {
  return `${cell.territoryName} · R${cell.row + 1} · C${cell.col + 1}`;
}
