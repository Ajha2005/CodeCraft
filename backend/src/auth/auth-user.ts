// What the rest of the backend knows about the caller. It comes from the access
// token alone (no database read per request), so it carries only what a route
// needs to decide: who, and whether this is a demo (guest) session.

export type Role = 'USER' | 'GUEST';

/** Guest sessions have no database row; their id is "guest:<uuid>" so it can never be mistaken for a user UUID. */
export const GUEST_PREFIX = 'guest:';

/** A demo session lasts two hours, whatever JWT_EXPIRES_IN says for real accounts. */
export const GUEST_TOKEN_TTL_SECONDS = 2 * 60 * 60;

export interface AuthUser {
  /** A user UUID, or "guest:<uuid>" for a demo session. */
  userId: string;
  /** Only on real accounts: a demo session carries nothing personal. */
  email?: string;
  role: Role;
  isGuest: boolean;
}

/**
 * The claims inside our access tokens. Tokens issued before demo sessions
 * existed carry no `role` (and an email): they are accounts, and stay valid.
 */
export interface AccessTokenPayload {
  sub: string;
  email?: string;
  role?: Role;
}

export function isGuestId(id: unknown): boolean {
  return typeof id === 'string' && id.startsWith(GUEST_PREFIX);
}

export const GUEST_FORBIDDEN_MESSAGE =
  'Demo mode is read-only. Sign in with a Thapar ID to do this.';

/**
 * Turns verified token claims into the caller, or null when the claims make no
 * sense. A guest token must carry a guest id and an account token a user id,
 * otherwise one kind of session could pose as the other.
 */
export function userFromPayload(
  payload: Partial<AccessTokenPayload> | null | undefined,
): AuthUser | null {
  const sub = payload?.sub;
  const role = payload?.role ?? 'USER';
  if (typeof sub !== 'string' || sub.length === 0) return null;
  if (role !== 'USER' && role !== 'GUEST') return null;

  const isGuest = role === 'GUEST';
  if (isGuest !== isGuestId(sub)) return null;
  if (isGuest) return { userId: sub, role, isGuest };
  return {
    userId: sub,
    ...(typeof payload?.email === 'string' ? { email: payload.email } : {}),
    role,
    isGuest,
  };
}
