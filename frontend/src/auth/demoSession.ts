// What the browser needs to know about a demo (guest) session on its own: how to
// recognise one from its token, when it runs out, and how to tell a visitor whose
// demo ended why they are back on the login page. The server decides what a demo
// may do; this only saves a failed request and a confusing screen.

const ENDED_KEY = 'cc.demoEnded.v1';

/** The text a disabled write control shows a demo visitor. */
export const GUEST_LOCK_TOOLTIP = 'Sign in with a Thapar ID to do this';

interface Claims {
  exp?: unknown;
  role?: unknown;
}

/** The claims inside a JWT, or null if it cannot be read. Nothing here is verified: never use it to decide what someone may do. */
function claimsOf(token: string | null): Claims | null {
  if (!token) return null;
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
    const claims: unknown = JSON.parse(json);
    return claims && typeof claims === 'object' ? (claims as Claims) : null;
  } catch {
    return null;
  }
}

/** True when the token was issued by "Try the demo" rather than by signing in. */
export function isDemoToken(token: string | null): boolean {
  return claimsOf(token)?.role === 'GUEST';
}

/** When the token stops working, in ms since the epoch, or null if it cannot be read. */
export function tokenExpiresAt(token: string | null): number | null {
  const exp = claimsOf(token)?.exp;
  return typeof exp === 'number' ? exp * 1000 : null;
}

/** Leaves a note for the login page: this visit ended because the demo ran out, not because the visitor left. */
export function noteDemoEnded(): void {
  try {
    sessionStorage.setItem(ENDED_KEY, '1');
  } catch {
    // the note is a courtesy
  }
}

/** True once, if the last sign-out was a demo running out. */
export function takeDemoEndedNote(): boolean {
  try {
    const ended = sessionStorage.getItem(ENDED_KEY) !== null;
    sessionStorage.removeItem(ENDED_KEY);
    return ended;
  } catch {
    return false;
  }
}
