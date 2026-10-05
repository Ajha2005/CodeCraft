import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { LOGIN_GREETINGS, pickDaily } from '../lib/flavorText'
import { API_BASE, request } from '../lib/http'
import { FlavorToggle } from '../components/FlavorToggle'
import { takeSessionEndedNote } from './session'
import { useAuth } from './useAuth'

interface TopCommander {
  username: string
  score: number
}

interface CaptureCell {
  id: number
  active: boolean
  delay: number
  duration: number
}

function makeCaptureGrid(cols: number, rows: number): CaptureCell[] {
  return Array.from({ length: cols * rows }, (_, i) => ({
    id: i,
    active: Math.random() < 0.18,
    delay: Math.random() * 5,
    duration: 3.5 + Math.random() * 3,
  }))
}

function LoginPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const error = searchParams.get('error')
  const { flavorTextEnabled, startDemo } = useAuth()
  // Read once: tells a visitor whose session ran out why they are back here.
  const [sessionEnded] = useState(takeSessionEndedNote)
  const [demoStarting, setDemoStarting] = useState(false)
  const [demoError, setDemoError] = useState('')
  const greeting = useMemo(
    () => (flavorTextEnabled ? pickDaily(LOGIN_GREETINGS) : 'Sign in to pick up where you left off.'),
    [flavorTextEnabled],
  )

  const [topCommander, setTopCommander] = useState<TopCommander | null>(null)
  const [problemCount, setProblemCount] = useState<number | null>(null)
  const [zoneCount, setZoneCount] = useState<number | null>(null)

  const captureGrid = useMemo(() => makeCaptureGrid(14, 8), [])

  // These three are the only calls the server answers without a sign-in.
  useEffect(() => {
    request<TopCommander[]>('/leaderboard/college?limit=1', { auth: false })
      .then((data) => setTopCommander(data[0] ?? null))
      .catch(() => {})

    request<{ total?: number }>('/problems?limit=1', { auth: false })
      .then((data) => setProblemCount(data?.total ?? null))
      .catch(() => {})

    request<unknown[]>('/territories', { auth: false })
      .then((data) => setZoneCount(Array.isArray(data) ? data.length : null))
      .catch(() => {})
  }, [])

  function handleGoogleLogin() {
    window.location.href = `${API_BASE}/auth/google`
  }

  function handleDemo() {
    if (demoStarting) return
    setDemoStarting(true)
    setDemoError('')
    startDemo()
      .then(() => navigate('/', { replace: true }))
      .catch((err: unknown) => {
        setDemoError(err instanceof Error ? err.message : 'The demo could not be started right now.')
        setDemoStarting(false)
      })
  }

  const statItems = [
    problemCount !== null ? `${problemCount} problems live` : null,
    zoneCount !== null ? `${zoneCount} zones on the map` : null,
    topCommander ? `🏆 ${topCommander.username} leads the campaign` : null,
  ].filter((item): item is string => Boolean(item))

  return (
    <div className="h-dvh hud-grid-bg flex flex-col overflow-hidden relative">
      <nav className="relative z-20 flex items-center justify-end px-6 md:px-10 py-4">
        <FlavorToggle />
      </nav>

      <div className="relative flex-1 flex flex-col items-center justify-center text-center px-6">
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[1000px] h-[1000px] rounded-full bg-cyan-500/10 blur-3xl" />

          <div className="absolute inset-0 opacity-70">
            <div
              className="grid h-full w-full"
              style={{ gridTemplateColumns: 'repeat(14, 1fr)', gridTemplateRows: 'repeat(8, 1fr)' }}
            >
              {captureGrid.map((cell) => (
                <div key={cell.id} className="border border-cyan-500/[0.06]">
                  {cell.active && (
                    <div
                      className="h-full w-full animate-cell-capture bg-cyan-400/20"
                      style={
                        {
                          animationDelay: `${cell.delay}s`,
                          animationDuration: `${cell.duration}s`,
                        } as CSSProperties
                      }
                    />
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="absolute inset-x-0 h-40 bg-gradient-to-b from-transparent via-cyan-400/[0.06] to-transparent animate-scan-sweep" />
        </div>

        <div className="relative z-10 animate-fade-in-up max-w-2xl mx-auto">
          <p
            className="text-xs tracking-[0.5em] text-cyan-400 uppercase mb-6"
            style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 700 }}
          >
            Now Live
          </p>

          <h1
            className="tracking-wide mb-6"
            style={{
              fontFamily: "'Rajdhani', sans-serif",
              fontWeight: 700,
              color: '#f1f5f9',
              fontSize: 'clamp(2.5rem, 10vw, 6rem)',
            }}
          >
            Code
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-teal-300 to-cyan-300">
              Craft
            </span>
          </h1>

          <p
            className="text-lg sm:text-2xl tracking-[0.5em] text-slate-300 uppercase mb-8"
            style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 600 }}
          >
            Claim Your Territory
          </p>

          <p className="text-slate-400 text-base max-w-lg mx-auto mb-8 leading-relaxed">{greeting}</p>

          {error === 'domain_not_allowed' && (
            <p className="text-sm text-red-400 mb-10 bg-red-950/40 border border-red-800/50 rounded-lg py-2 px-4 inline-block">
              Only @thapar.edu accounts can sign in. Please try again with your institutional email.
            </p>
          )}

          {error === 'google_auth_failed' && (
            <p className="text-sm text-red-400 mb-10 bg-red-950/40 border border-red-800/50 rounded-lg py-2 px-4 inline-block">
              Google sign-in didn't finish. Please try again — if it keeps happening, check that your browser
              accepts cookies for this site, or contact the site admin.
            </p>
          )}

          {sessionEnded && !error && (
            <p className="text-sm text-amber-300 mb-10 bg-amber-950/30 border border-amber-800/40 rounded-lg py-2 px-4 inline-block">
              Your session ended. Sign in again to carry on.
            </p>
          )}

          <button
            onClick={handleGoogleLogin}
            className="flex items-center justify-center gap-3 rounded-full px-8 py-3.5 text-sm font-semibold bg-slate-100 text-slate-900 hover:bg-white transition-all hover:scale-[1.03] active:scale-[0.98] animate-glow-pulse mx-auto mb-6"
          >
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path
                fill="#FFC107"
                d="M43.6 20.5H42V20.5H24v7h11.3C33.9 31.9 29.4 35 24 35c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l5-5C33.9 5.1 29.2 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21 21-9.4 21-21c0-1.2-.1-2.4-.4-3.5z"
              />
              <path
                fill="#FF3D00"
                d="M6.3 14.7l6.6 4.8C14.5 15.4 18.9 12 24 12c3.1 0 5.8 1.1 8 3l5-5C33.9 5.1 29.2 3 24 3 16.3 3 9.7 7.3 6.3 14.7z"
              />
              <path
                fill="#4CAF50"
                d="M24 45c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 36.1 26.7 37 24 37c-5.4 0-9.9-3.1-11.3-7.5l-6.5 5C9.6 40.6 16.2 45 24 45z"
              />
              <path
                fill="#1976D2"
                d="M43.6 20.5H42V20.5H24v7h11.3c-.7 2.1-2 3.9-3.7 5.2l6.2 5.2C41.9 34.4 45 29.7 45 24c0-1.2-.1-2.4-.4-3.5z"
              />
            </svg>
            Sign in with Google
          </button>
          <p className="text-xs text-slate-500 mb-5">New commander? Signing in enlists you automatically.</p>

          <div className="mx-auto mb-6 max-w-sm border-t border-slate-800/80 pt-5">
            <button
              type="button"
              onClick={handleDemo}
              disabled={demoStarting}
              className="rounded-full border border-cyan-400/40 px-6 py-2.5 text-sm font-semibold text-cyan-200 transition-all hover:border-cyan-300 hover:bg-cyan-400/10 disabled:opacity-60 disabled:hover:bg-transparent"
            >
              {demoStarting ? 'Starting the demo…' : 'Try the demo'}
            </button>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              No Thapar ID? Look around read-only: browse the problems, run code on the sample cases and explore the live map.
            </p>
            {demoError && <p className="mt-2 text-xs text-red-400">{demoError}</p>}
          </div>

          {statItems.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-2">
              {statItems.map((item) => (
                <span
                  key={item}
                  className="px-3 py-1 rounded-full border border-slate-800 text-slate-500 text-xs uppercase tracking-[0.1em]"
                >
                  {item}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default LoginPage
