import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './useAuth'

function Centered({ children }: { children: ReactNode }) {
  return <div className="hud-grid-bg flex min-h-dvh flex-1 items-center justify-center px-6 text-center">{children}</div>
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading, unreachable, retryAuth } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <Centered>
        <div className="relative z-10 flex flex-col items-center gap-4">
          <div className="relative h-12 w-12">
            <div className="hex absolute inset-0 animate-spin-slow bg-gradient-to-b from-cyan-400/80 to-teal-600/30" />
            <div className="hex absolute inset-[3px] bg-slate-950" />
          </div>
          <p className="font-display text-sm font-bold uppercase tracking-[0.3em] text-cyan-300">Checking in…</p>
        </div>
      </Centered>
    )
  }

  // The player is still signed in; the server just did not answer.
  if (unreachable) {
    return (
      <Centered>
        <div className="hud-panel relative z-10 max-w-sm p-6">
          <p className="text-sm text-slate-300">Can’t reach CodeCraft right now. You’re still signed in — this is usually a short hiccup.</p>
          <button type="button" onClick={retryAuth} className="btn-primary mt-4 h-10 rounded-lg px-5 text-sm">
            Try again
          </button>
        </div>
      </Centered>
    )
  }

  if (!user) {
    // remember where they were headed so signing in brings them back
    const from = location.pathname + location.search
    return <Navigate to="/login" replace state={{ from }} />
  }

  return <>{children}</>
}

export default ProtectedRoute
