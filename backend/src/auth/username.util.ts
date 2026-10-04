import { randomBytes } from 'crypto';

/** The shape of a stored username (the same rule SignupDto enforces, in lowercase). */
export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

/**
 * A neutral default username such as "player_ab12cd". It is never derived
 * from the email or the real name, so it is safe to show publicly.
 */
export function randomUsername(): string {
  return `player_${randomBytes(3).toString('hex')}`;
}
