// The one place that knows where the access token lives and when it stops being
// good. Everything else (the axios client, fetch helpers, the socket, the auth
// context) asks here, so a sign-out or an expired session is noticed once.

const TOKEN_KEY = 'accessToken';
const ENDED_KEY = 'cc.sessionEnded';

export function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function storeToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // private mode etc.: the session then lasts until the page is reloaded
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // nothing stored, nothing to clear
  }
}

/** When the token stops working, in ms since the epoch, or null if it cannot be read. The server still decides; this only saves a failed request. */
export function tokenExpiresAt(token: string | null): number | null {
  if (!token) return null;
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}

// ---- "your session ended" -------------------------------------------------

const events = new EventTarget();
const EXPIRED = 'session-expired';

/** Called when the server says the token is no longer valid (401) or it ran out. Signs the app out and leaves a note for the login page. */
export function expireSession(): void {
  if (!readToken()) return; // already signed out
  try {
    sessionStorage.setItem(ENDED_KEY, '1');
  } catch {
    // the note is a courtesy
  }
  events.dispatchEvent(new Event(EXPIRED));
}

export function onSessionExpired(listener: () => void): () => void {
  events.addEventListener(EXPIRED, listener);
  return () => events.removeEventListener(EXPIRED, listener);
}

/** True once, if the last sign-out was because the session ended rather than the user choosing it. */
export function takeSessionEndedNote(): boolean {
  try {
    const ended = sessionStorage.getItem(ENDED_KEY) !== null;
    sessionStorage.removeItem(ENDED_KEY);
    return ended;
  } catch {
    return false;
  }
}
