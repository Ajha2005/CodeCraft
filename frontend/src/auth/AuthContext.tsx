import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

interface User {
  userId: string
  email: string
  name: string | null
}

interface AuthContextType {
  token: string | null
  user: User | null
  loading: boolean
  login: (token: string) => void
  logout: () => void
  flavorTextEnabled: boolean
  setFlavorTextEnabled: (enabled: boolean) => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

const API_BASE = 'http://localhost:3000'
const FLAVOR_STORAGE_KEY = 'flavorTextEnabled'

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
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [flavorTextEnabled, setFlavorTextEnabledState] = useState(readStoredFlavorPreference)

  useEffect(() => {
    if (!token) {
      setUser(null)
      setLoading(false)
      return
    }

    fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error('Invalid or expired token')
        return res.json()
      })
      .then((data: User & { flavorTextEnabled: boolean }) => {
        setUser(data)
        setFlavorTextEnabledState(data.flavorTextEnabled)
        try {
          localStorage.setItem(FLAVOR_STORAGE_KEY, String(data.flavorTextEnabled))
        } catch {
          // best-effort — a per-viewer convenience, not critical state
        }
      })
      .catch(() => {
        localStorage.removeItem('accessToken')
        setToken(null)
        setUser(null)
      })
      .finally(() => setLoading(false))
  }, [token])

  function login(newToken: string) {
    localStorage.setItem('accessToken', newToken)
    setToken(newToken)
  }

  function logout() {
    localStorage.removeItem('accessToken')
    setToken(null)
    setUser(null)
  }

  function setFlavorTextEnabled(enabled: boolean) {
    setFlavorTextEnabledState(enabled)
    try {
      localStorage.setItem(FLAVOR_STORAGE_KEY, String(enabled))
    } catch {
      // ignore — see above
    }
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
      value={{ token, user, loading, login, logout, flavorTextEnabled, setFlavorTextEnabled }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}
