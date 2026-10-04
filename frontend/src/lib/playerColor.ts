// Mirrors backend/src/common/color/color.util.ts so the frontend can color a
// player *anywhere* (leaderboard rows, contest cards, the map avatar) exactly
// as the server colors their territory - without an extra API round trip.
// If the backend palette or hash ever changes, change it here too.

const PALETTE = [
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#eab308',
  '#84cc16',
  '#22c55e',
  '#10b981',
  '#14b8a6',
  '#06b6d4',
  '#0ea5e9',
  '#3b82f6',
  '#6366f1',
  '#8b5cf6',
  '#a855f7',
  '#d946ef',
  '#ec4899',
  '#f43f5e',
] as const;

export const UNCLAIMED_COLOR = '#94a3b8';

function hashString(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return hash >>> 0;
}

export function colorForUser(userId: string | null | undefined): string {
  if (!userId) return UNCLAIMED_COLOR;
  return PALETTE[hashString(userId) % PALETTE.length];
}

/** Up-to-two-letter initials for avatar badges. */
export function initialsOf(name: string | null | undefined, fallback = '?'): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
