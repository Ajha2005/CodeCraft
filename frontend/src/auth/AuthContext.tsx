import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ApiError, request } from '../lib/http'
import { resetSocket } from '../lib/socket'
import { AuthContext, type User } from './useAuth'
import { clearToken, onSessionExpired, readToken, storeToken, tokenExpiresAt } from './session'

const FLAVOR_STORAGE_KEY = 'flavorTextEnabled'

type MeResponse = User & { flavorTextEnabled: boolean }

function readStoredFlavorPreference(): boolean {
  try {
    const raw = localStorage.getItem(FLAVOR_STORAGE_KEY)
    return raw === null ? true : raw === 'true'
  } catch {
    return true
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(readToken)
  // Who the token belongs to, tagged with the token it was fetched for, so a stale answer can never be taken for the current one.
  const [session, setSession] = useState<{ token: string; user: User } | null>(null)
  const [failedToken, setFailedToken] = useState<string | null>(null)
  const [flavorTextEnabled, setFlavorTextEnabledState] = useState(readStoredFlavorPreference)

  const user = token && session?.token === token ? session.user : null
  const loading = !!token && !user && failedToken !== token

  const endSession = useCallback(() => {
    clearToken()
    setToken(null)
    setSession(null)
    resetSocket()
  }, [])

  // Who is behind the token?
  useEffect(() => {
    if (!token) return
    let cancelled = false
    request<MeResponse>('/auth/me')
      .then((data) => {
        if (cancelled) return
        const { flavorTextEnabled: flavor, ...me } = data
        setSession({ token, user: me })
        setFlavorTextEnabledState(flavor)
        try {
          localStorage.setItem(FLAVOR_STORAGE_KEY, String(flavor))
        } catch {
          // best-effort — a per-viewer convenience, not critical state
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        // A 401 has already signed the app out (see request); anything else leaves the visitor on the login page.
        if (!(err instanceof ApiError) || err.status !== 401) {
          clearToken()
          setToken(null)
        }
        setFailedToken(token)
      })
    return () => {
      cancelled = true
    }
  }, [token])

  // The server ends a session by answering 401; the token also says when it runs out, so go quietly a moment before.
  useEffect(() => onSessionExpired(endSession), [endSession])
  useEffect(() => {
    const expiresAt = tokenExpiresAt(token)
    if (!expiresAt) return
    const wait = expiresAt - Date.now() - 5_000
    const timer = window.setTimeout(endSession, Math.min(Math.max(wait, 0), 2 ** 31 - 1))
    return () => window.clearTimeout(timer)
  }, [token, endSession])

  const login = useCallback((newToken: string) => {
    storeToken(newToken)
    setToken(newToken)
    resetSocket()
  }, [])

  const startDemo = useCallback(async () => {
    try {
      const data = await request<{ accessToken: string }>('/auth/guest', { method: 'POST', body: {}, auth: false })
      login(data.accessToken)
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        throw new Error('Too many demo sessions have been started from your network. Please try again in a little while.', { cause: err })
      }
      throw new Error('The demo could not be started right now. Please try again in a moment.', { cause: err })
    }
  }, [login])

  const logout = endSession

  const setFlavorTextEnabled = useCallback(
    (enabled: boolean) => {
      setFlavorTextEnabledState(enabled)
      try {
        localStorage.setItem(FLAVOR_STORAGE_KEY, String(enabled))
      } catch {
        // ignore — see above
      }
      // A demo session has no account to save the setting on; it stays in this browser.
      if (!token || user?.isGuest) return
      request('/auth/settings', { method: 'PATCH', body: { flavorTextEnabled: enabled } }).catch(() => {
        // UI already updated optimistically; a failed sync just means the
        // preference falls back to session-only until the next successful save
      })
    },
    [token, user?.isGuest],
  )

  const value = useMemo(
    () => ({ token, user, loading, isGuest: !!user?.isGuest, login, startDemo, logout, flavorTextEnabled, setFlavorTextEnabled }),
    [token, user, loading, login, startDemo, logout, flavorTextEnabled, setFlavorTextEnabled],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
