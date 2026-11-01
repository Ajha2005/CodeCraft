// Where to send a player after they sign in. The Google sign-in leaves the site
// and comes back to /auth/callback, so the destination waits in sessionStorage.

const KEY = 'cc.returnTo'

/** Only same-site paths are ever followed, so a crafted link cannot bounce a player elsewhere. */
function safe(path: string | null | undefined): string | null {
  return path && path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/login') && !path.startsWith('/auth/') ? path : null
}

export function rememberReturnTo(path: string | null | undefined) {
  const ok = safe(path)
  try {
    if (ok) sessionStorage.setItem(KEY, ok)
  } catch {
    // fine: they land on the home page instead
  }
}

export function takeReturnTo(): string {
  try {
    const stored = safe(sessionStorage.getItem(KEY))
    sessionStorage.removeItem(KEY)
    return stored ?? '/'
  } catch {
    return '/'
  }
}
