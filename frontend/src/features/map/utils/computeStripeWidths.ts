export interface OwnerShare {
  /** An opaque per-owner key (the owner's username), not a database id. */
  userId: string;
  color: string;
  cellCount: number;
  /** Public handle, when the server sent one with the cells. */
  username?: string | null;
  /** Whether this owner is the signed-in player (decided by the server). */
  isMe: boolean;
}

export interface StripeSegment extends OwnerShare {
  pct: number;
  offset: number;
}

const MIN_VISIBLE_PCT = 6;

export function computeStripeWidths(ownership: OwnerShare[]): StripeSegment[] {
  const total = ownership.reduce((sum, o) => sum + o.cellCount, 0);
  if (total === 0) return [];

  // sort descending so majority owner renders first/largest, stable across re-renders
  const sorted = [...ownership].sort((a, b) => b.cellCount - a.cellCount);

  const raw = sorted.map(o => ({ ...o, pct: (o.cellCount / total) * 100 }));
  const boosted = raw.map(o => ({ ...o, pct: Math.max(o.pct, MIN_VISIBLE_PCT) }));
  const boostedTotal = boosted.reduce((sum, o) => sum + o.pct, 0);
  const normalized = boosted.map(o => ({ ...o, pct: (o.pct / boostedTotal) * 100 }));

  let cumulative = 0;
  return normalized.map(o => {
    const segment = { ...o, offset: cumulative };
    cumulative += o.pct;
    return segment;
  });
}
interface CellOwnershipInput {
  ownerId?: string | null;
  ownerUsername?: string | null;
  ownerColor?: string;
  isMe?: boolean;
}

export function aggregateOwnership(cells: CellOwnershipInput[]): OwnerShare[] {
  const counts = new Map<string, { color: string; username: string | null; cellCount: number; isMe: boolean }>();
  for (const cell of cells) {
    if (!cell.ownerId) continue; // unclaimed cells don't count toward ownership
    const existing = counts.get(cell.ownerId);
    if (existing) {
      existing.cellCount += 1;
      if (!existing.username) existing.username = cell.ownerUsername ?? null;
    } else {
      counts.set(cell.ownerId, { color: cell.ownerColor ?? '#999999', username: cell.ownerUsername ?? null, cellCount: 1, isMe: !!cell.isMe });
    }
  }
  return Array.from(counts.entries()).map(([userId, v]) => ({
    userId,
    color: v.color,
    username: v.username,
    cellCount: v.cellCount,
    isMe: v.isMe,
  }));
}