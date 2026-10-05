import { createContext, useContext } from 'react';

/** Who is signed in. Never carries an email or a real name: the server does not send them. */
export interface User {
  userId: string;
  username: string;
  role: 'USER' | 'GUEST';
  /** A read-only demo session (the "Try Demo" button), not a real account. */
  isGuest: boolean;
}

export interface AuthContextType {
  token: string | null;
  user: User | null;
  loading: boolean;
  /** Shorthand for `user?.isGuest`. */
  isGuest: boolean;
  login: (token: string) => void;
  /** Starts a read-only demo session. Rejects with a message fit to show the visitor. */
  startDemo: () => Promise<void>;
  logout: () => void;
  flavorTextEnabled: boolean;
  setFlavorTextEnabled: (enabled: boolean) => void;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

/** The text a disabled write control shows a demo visitor. */
export const GUEST_LOCK_TOOLTIP = 'Sign in with a Thapar ID to do this';
