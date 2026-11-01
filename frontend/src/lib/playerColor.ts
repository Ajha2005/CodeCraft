// Player colours come from the server: every player has their own, unique to
// them (see backend/src/common/color/color.util.ts), and it is sent along with
// the player wherever they appear - on cells, leaderboards, duels and /auth/me.
// Nothing here works a colour out from an id any more, because only the server
// can know that no two players share one.

export const UNCLAIMED_COLOR = '#94a3b8';

const HEX = /^#[0-9a-f]{6}$/;

function hashString(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return hash >>> 0;
}

/**
 * Only for the rare moment a payload arrives without a colour (an older server,
 * a half-loaded list): a stable vivid colour so the player is still never grey.
 * Not unique, and replaced by the real one as soon as it is known.
 */
export function fallbackColor(userId: string | null | undefined): string {
  if (!userId) return UNCLAIMED_COLOR;
  const hue = hashString(userId) % 360;
  return `hsl(${hue} 90% 58%)`;
}

/**
 * The color to paint a cell. A cell somebody holds is always in its owner's
 * color: the one the server sent when it is a real player color, otherwise a
 * stable stand-in. A held cell can therefore never come out as the grey of an
 * unclaimed one, whatever a payload carried (nothing, a malformed value, or the
 * unclaimed color itself).
 */
export function cellOwnerColor(ownerId: string | null | undefined, sentColor?: string | null): string {
  if (!ownerId) return UNCLAIMED_COLOR;
  const sent = sentColor?.trim().toLowerCase();
  return sent && HEX.test(sent) && sent !== UNCLAIMED_COLOR ? sent : fallbackColor(ownerId);
}

/** Up-to-two-letter initials for avatar badges. */
export function initialsOf(name: string | null | undefined, fallback = '?'): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
