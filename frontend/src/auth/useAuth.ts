import { createContext, useContext } from 'react'

export interface User {
  userId: string
  email: string
  name: string | null
  /** The player's own map colour, unique to them. */
  color: string
}

export interface AuthContextType {
  token: string | null
  /** The signed-in player, or the guest while demo mode is on. */
  user: User | null
  loading: boolean
  /** A token is stored but the server could not be reached to check it (the player stays signed in). */
  unreachable: boolean
  /** Ask the server again after it could not be reached. */
  retryAuth: () => void
  /**
   * Demo mode: no account, no login. Problems can be solved and scored, but the
   * score stays on this device and no territory is awarded.
   */
  isDemo: boolean
  login: (token: string) => void
  enterDemo: () => void
  logout: () => void
  flavorTextEnabled: boolean
  setFlavorTextEnabled: (enabled: boolean) => void
}

/** The stand-in "player" while in demo mode. Never sent to the server as an id. */
export const DEMO_USER: User = { userId: 'demo', email: '', name: 'Guest', color: '#22d3ee' }

export const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}
