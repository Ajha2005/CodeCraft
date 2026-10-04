import { randomBytes } from 'crypto';

/**
 * A neutral default username such as "player_ab12cd". It is never derived
 * from the email or the real name, so it is safe to show publicly.
 */
export function randomUsername(): string {
  return `player_${randomBytes(3).toString('hex')}`;
}
