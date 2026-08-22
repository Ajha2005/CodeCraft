/**
 * Deterministic color assignment.
 *
 * Same userId -> same color, every time, with no DB lookup needed.
 * This matters because a territory's color must stay stable across
 * requests/sessions — you don't want the map flickering different
 * colors for the same owner on every refresh.
 *
 * Approach: hash the userId to an index into a curated palette.
 * Curated (not random HSL) so colors stay visually distinct and
 * readable against your map's background.
 */

// Keep this reasonably large (15-20+) so collisions across active
// players are rare. Tune to match your Tailwind theme later.
const PALETTE = [
  '#ef4444', // red-500
  '#f97316', // orange-500
  '#f59e0b', // amber-500
  '#eab308', // yellow-500
  '#84cc16', // lime-500
  '#22c55e', // green-500
  '#10b981', // emerald-500
  '#14b8a6', // teal-500
  '#06b6d4', // cyan-500
  '#0ea5e9', // sky-500
  '#3b82f6', // blue-500
  '#6366f1', // indigo-500
  '#8b5cf6', // violet-500
  '#a855f7', // purple-500
  '#d946ef', // fuchsia-500
  '#ec4899', // pink-500
  '#f43f5e', // rose-500
];

export const UNCLAIMED_COLOR = '#94a3b8'; // slate-400

/** Simple, fast string hash (djb2). No crypto needed here. */
function hashString(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return hash >>> 0; // force unsigned
}

export function getColorForUser(userId: string | null | undefined): string {
  if (!userId) return UNCLAIMED_COLOR;
  const index = hashString(userId) % PALETTE.length;
  return PALETTE[index];
}


//scratch test
