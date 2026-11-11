import { useAuth } from '../auth/useAuth'
import { Icon } from './ui/Icon'

/** A thin reminder, under the nav, that this session is a demo - and the way out of it. */
export function DemoBanner() {
  const { isDemo, logout } = useAuth()
  if (!isDemo) return null

  return (
    <div className="flex shrink-0 items-center justify-center gap-x-3 gap-y-1 border-b border-amber-400/20 demo-banner px-4 py-1.5 text-center text-xs text-amber-200/90">
      <Icon name="flask" className="hidden h-3.5 w-3.5 shrink-0 sm:block" />
      <span>
        <strong className="font-bold uppercase tracking-wide">Demo mode</strong>
        <span className="text-amber-100/70"> · scores stay on this device and no territory is awarded.</span>
      </span>
      <button type="button" onClick={logout} className="shrink-0 font-bold underline decoration-amber-300/50 underline-offset-2 hover:text-slate-50">
        Sign in
      </button>
    </div>
  )
}
