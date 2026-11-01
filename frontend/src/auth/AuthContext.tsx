import { useEffect, useState, type ReactNode } from 'react'
import { AuthContext, DEMO_USER, type User } from './useAuth'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000'
const FLAVOR_STORAGE_KEY = 'flavorTextEnabled'
const TOKEN_KEY = 'accessToken'
const DEMO_KEY = 'cc.demo.v1'

class RejectedToken extends Error {}

function readStoredFlavorPreference(): boolean {
  try {
    const raw = localStorage.getItem(FLAVOR_STORAGE_KEY)
    return raw === null ? true : raw === 'true'
  } catch {
    return true
  }
}

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

function readDemoFlag(): boolean {
  try {
    return localStorage.getItem(DEMO_KEY) === '1'
  } catch {
    return false
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // best-effort: without storage the session simply lasts until the tab closes
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(readToken)
  const [demo, setDemo] = useState(readDemoFlag)
  // The profile is stored with the token it was fetched for, so a new token can
  // never be paired with the previous player's profile - and "loading" is simply
  // "there is a token we have no profile for yet".
  const [profile, setProfile] = useState<{ token: string; user: User } | null>(null)
  const [flavorTextEnabled, setFlavorTextEnabledState] = useState(readStoredFlavorPreference)
  // Bumped to ask the server again, and remembers which token it could not be asked about.
  const [attempt, setAttempt] = useState(0)
  const [unreachableFor, setUnreachableFor] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    let ignore = false

    fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        // Only a refusal means the token is bad. A server that is down or still
        // waking up must not sign everybody out.
        if (res.status === 401 || res.status === 403) throw new RejectedToken()
        if (!res.ok) throw new Error(`Auth check failed: ${res.status}`)
        return res.json()
      })
      .then((data: User & { flavorTextEnabled: boolean }) => {
        if (ignore) return
        const { flavorTextEnabled: flavor, ...user } = data
        setProfile({ token, user })
        setUnreachableFor(null)
        setFlavorTextEnabledState(flavor)
        writeStorage(FLAVOR_STORAGE_KEY, String(flavor))
      })
      .catch((err: unknown) => {
        if (ignore) return
        if (err instanceof RejectedToken) {
          writeStorage(TOKEN_KEY, null)
          setToken(null)
        } else {
          setUnreachableFor(token)
        }
      })

    return () => {
      ignore = true
    }
  }, [token, attempt])

  const isDemo = !token && demo
  const signedIn = token !== null && profile?.token === token ? profile.user : null
  const unreachable = token !== null && signedIn === null && unreachableFor === token
  const loading = token !== null && signedIn === null && !unreachable
  const user = signedIn ?? (isDemo ? DEMO_USER : null)

  function retryAuth() {
    setUnreachableFor(null)
    setAttempt((n) => n + 1)
  }

  function login(newToken: string) {
    writeStorage(TOKEN_KEY, newToken)
    writeStorage(DEMO_KEY, null)
    setDemo(false)
    setToken(newToken)
  }

  function enterDemo() {
    writeStorage(TOKEN_KEY, null)
    writeStorage(DEMO_KEY, '1')
    setToken(null)
    setDemo(true)
  }

  function logout() {
    writeStorage(TOKEN_KEY, null)
    writeStorage(DEMO_KEY, null)
    setToken(null)
    setDemo(false)
    setProfile(null)
  }

  function setFlavorTextEnabled(enabled: boolean) {
    setFlavorTextEnabledState(enabled)
    writeStorage(FLAVOR_STORAGE_KEY, String(enabled))
    if (!token) return
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
  }

  return (
    <AuthContext.Provider
      value={{ token, user, loading, unreachable, retryAuth, isDemo, login, enterDemo, logout, flavorTextEnabled, setFlavorTextEnabled }}
    >
      {children}
    </AuthContext.Provider>
  )
}
