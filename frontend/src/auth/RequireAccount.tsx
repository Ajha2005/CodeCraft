import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/ui/Icon'
import { useAuth } from './useAuth'

/** Gates a page that only makes sense with a real account (duels need rivals and cells of your own). */
export function RequireAccount({ feature, children }: { feature: string; children: ReactNode }) {
  const { isDemo, logout } = useAuth()
  if (!isDemo) return <>{children}</>

  return (
    <div className="hud-grid-bg flex min-h-[calc(100dvh-var(--nav-h))] flex-1 items-center justify-center px-4">
      <div className="hud-panel relative z-10 max-w-md p-7 text-center animate-pop-in">
        <Icon name="lock" className="mx-auto h-9 w-9 text-amber-300" />
        <h1 className="font-display mt-3 text-2xl font-bold uppercase tracking-wide text-slate-50">{feature} need an account</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          Demo mode is for trying the problems. {feature} are played for territory, so they need a Thapar account, and demo players don’t hold any
          cells yet.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          <button type="button" onClick={logout} className="btn-primary h-10 rounded-lg px-5 text-sm">
            Sign in with Thapar ID
          </button>
          <Link to="/" className="btn-ghost h-10 rounded-lg px-5 text-sm">
            Back to problems
          </Link>
        </div>
      </div>
    </div>
  )
}
