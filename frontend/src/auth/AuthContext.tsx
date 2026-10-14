import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { isDemoToken, noteDemoEnded, tokenExpiresAt } from './demoSession'

interface User {
  userId: string
  email: string
  name: string | null
  /** A read-only demo session ("Try the demo"), not an account. */
  isGuest?: boolean
}

interface AuthContextType {
  token: string | null
  user: User | null
  loading: boolean
  /** Shorthand for `user?.isGuest`: a demo visitor, who can look around but not change anything. */
  isGuest: boolean
  login: (token: string) => void
  /** Starts a read-only demo session. Rejects with a message fit to show the visitor. */
  startDemo: () => Promise<void>
  logout: () => void
  flavorTextEnabled: boolean
  setFlavorTextEnabled: (enabled: boolean) => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000'
const FLAVOR_STORAGE_KEY = 'flavorTextEnabled'
const DEMO_UNAVAILABLE = 'The demo could not be started right now. Please try again in a moment.'
const DEMO_RATE_LIMITED = 'Too many demo sessions have been started from your network. Please try again in a little while.'

function readStoredFlavorPreference(): boolean {
  try {
    const raw = localStorage.getItem(FLAVOR_STORAGE_KEY)
    return raw === null ? true : raw === 'true'
  } catch {
    return true
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('accessToken'))
  // Who the token belongs to, tagged with the token it was fetched for, so the answer for an
  // earlier token is never taken for the current one (and a fresh sign-in is "loading", never "nobody").
  const [session, setSession] = useState<{ token: string; user: User } | null>(null)
  const [flavorTextEnabled, setFlavorTextEnabledState] = useState(readStoredFlavorPreference)

  const user = token && session?.token === token ? session.user : null
  const loading = !!token && !user

  useEffect(() => {
    if (!token) return
    let cancelled = false

    fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error('Invalid or expired token')
        return res.json()
      })
      .then((data: User & { flavorTextEnabled: boolean }) => {
        if (cancelled) return
        setSession({ token, user: data })
        // A demo has no saved preference of its own: it keeps whatever this browser already had.
        if (data.isGuest) return
        setFlavorTextEnabledState(data.flavorTextEnabled)
        try {
          localStorage.setItem(FLAVOR_STORAGE_KEY, String(data.flavorTextEnabled))
        } catch {
          // best-effort — a per-viewer convenience, not critical state
        }
      })
      .catch(() => {
        if (cancelled) return
        // A demo that ran out (or was reset on the server) should say so on the login page.
        if (isDemoToken(token)) noteDemoEnded()
        localStorage.removeItem('accessToken')
        setToken(null)
        setSession(null)
      })

    return () => {
      cancelled = true
    }
  }, [token])

  const login = useCallback((newToken: string) => {
    localStorage.setItem('accessToken', newToken)
    setToken(newToken)
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem('accessToken')
    setToken(null)
    setSession(null)
  }, [])

  // A demo lasts two hours. When it runs out the server starts answering 401, so end it
  // here a moment before, and leave a note that tells the visitor why they are back at the login page.
  useEffect(() => {
    if (!token || !isDemoToken(token)) return
    const expiresAt = tokenExpiresAt(token)
    if (expiresAt === null) return
    const wait = Math.min(Math.max(expiresAt - Date.now() - 5_000, 0), 2 ** 31 - 1)
    const timer = window.setTimeout(() => {
      noteDemoEnded()
      logout()
    }, wait)
    return () => window.clearTimeout(timer)
  }, [token, logout])

  const startDemo = useCallback(async () => {
    let res: Response
    try {
      res = await fetch(`${API_BASE}/auth/guest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
    } catch (err) {
      throw new Error(DEMO_UNAVAILABLE, { cause: err })
    }
    if (res.status === 429) throw new Error(DEMO_RATE_LIMITED)
    const body: { accessToken?: unknown } | null = res.ok ? await res.json().catch(() => null) : null
    if (typeof body?.accessToken !== 'string' || !body.accessToken) throw new Error(DEMO_UNAVAILABLE)
    login(body.accessToken)
  }, [login])

  const setFlavorTextEnabled = useCallback(
    (enabled: boolean) => {
      setFlavorTextEnabledState(enabled)
      try {
        localStorage.setItem(FLAVOR_STORAGE_KEY, String(enabled))
      } catch {
        // ignore — see above
      }
      // A demo session has no account to keep the setting on; it stays in this browser.
      if (!token || isDemoToken(token)) return
      fetch(`${API_BASE}/auth/settings`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ flavorTextEnabled: enabled }),
      }).catch(() => {
        // UI already updated optimistically; a failed sync just means the
        // preference falls back to session-only until the next successful save
      })
    },
    [token],
  )

  const value = useMemo(
    () => ({ token, user, loading, isGuest: !!user?.isGuest, login, startDemo, logout, flavorTextEnabled, setFlavorTextEnabled }),
    [token, user, loading, login, startDemo, logout, flavorTextEnabled, setFlavorTextEnabled],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}
