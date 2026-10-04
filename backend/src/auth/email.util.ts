// The only addresses that may hold an account: <local>@thapar.edu, in one
// canonical spelling. Checked in ASCII first and lower-cased afterwards, so a
// look-alike character can never be folded into a plain letter, and anything
// unusual (quoted local parts like "a@evil.com"@thapar.edu, spaces, a second
// @, a longer domain such as thapar.edu.evil.com) is simply not an address we
// accept.

export const ALLOWED_EMAIL_DOMAIN = 'thapar.edu';

const ASCII_ADDRESS = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}@[A-Za-z0-9.-]{1,253}$/;

/** The canonical (lower-case) address, or null if it is not an acceptable @thapar.edu address. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim();
  if (email.length > 254 || !ASCII_ADDRESS.test(email)) return null;
  const lowered = email.toLowerCase();
  const [local, domain] = lowered.split('@');
  if (domain !== ALLOWED_EMAIL_DOMAIN) return null;
  if (local.includes('..') || local.endsWith('.')) return null;
  return lowered;
}
