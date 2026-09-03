import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

interface User {
  userId: string
  email: string
}

interface AuthContextType {
  token: string | null
  user: User | null
  loading: boolean
  login: (token: string) => void
  logout: () => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

const API_BASE = 'http://localhost:3000'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('accessToken'))
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

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
      .then((data: User) => setUser(data))
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

  return (
    <AuthContext.Provider value={{ token, user, loading, login, logout }}>
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