// What the rest of the backend knows about the caller. It comes from the
// access token alone (no database read per request), so it carries only what a
// route needs to decide: who, and whether this is a demo (guest) session.

export type Role = 'USER' | 'GUEST';

/** Guest sessions have no database row; their id is "guest:<uuid>" so it can never be mistaken for a user UUID. */
export const GUEST_PREFIX = 'guest:';

export interface AuthUser {
  /** A user UUID, or "guest:<uuid>" for a demo session. */
  userId: string;
  role: Role;
  isGuest: boolean;
}

/** The claims inside our access tokens (standard iat/exp/iss/aud aside). */
export interface AccessTokenPayload {
  sub: string;
  role: Role;
}

export function isGuestId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(GUEST_PREFIX);
}

export const GUEST_FORBIDDEN_MESSAGE = 'Demo mode is read-only. Sign in with a Thapar ID to do this.';

/**
 * Turns verified token claims into the caller, or null when the claims make no
 * sense. A guest token must carry a guest id and a user token a user id,
 * otherwise one kind of session could pose as the other.
 */
export function userFromPayload(payload: Partial<AccessTokenPayload> | null | undefined): AuthUser | null {
  const sub = payload?.sub;
  const role = payload?.role;
  if (typeof sub !== 'string' || (role !== 'USER' && role !== 'GUEST')) return null;
  const isGuest = role === 'GUEST';
  if (isGuest !== isGuestId(sub)) return null;
  return { userId: sub, role, isGuest };
}
