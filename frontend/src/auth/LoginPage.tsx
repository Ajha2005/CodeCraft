import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { LOGIN_GREETINGS, pickDaily, rankTitle } from '../lib/flavorText'
import { FlavorToggle } from '../components/FlavorToggle'
import { useAuth } from './AuthContext'

const API_BASE = 'http://localhost:3000'

interface TopCommander {
  userId: string
  name: string
  score: number
}

const medal = ['🥇', '🥈', '🥉']

function LoginPage() {
  const [searchParams] = useSearchParams()
  const error = searchParams.get('error')
  const { flavorTextEnabled } = useAuth()
  const greeting = useMemo(
    () => (flavorTextEnabled ? pickDaily(LOGIN_GREETINGS) : 'Sign in to pick up where you left off.'),
    [flavorTextEnabled],
  )

  const [topCommanders, setTopCommanders] = useState<TopCommander[]>([])
  const [problemCount, setProblemCount] = useState<number | null>(null)
  const [zoneCount, setZoneCount] = useState<number | null>(null)
  const [showCommanders, setShowCommanders] = useState(false)

  useEffect(() => {
    fetch(`${API_BASE}/leaderboard/college?limit=3`)
      .then((res) => (res.ok ? res.json() : []))
      .then(setTopCommanders)
      .catch(() => {})

    fetch(`${API_BASE}/problems?limit=1`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setProblemCount(data?.total ?? null))
      .catch(() => {})

    fetch(`${API_BASE}/territories`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setZoneCount(Array.isArray(data) ? data.length : null))
      .catch(() => {})
  }, [])

  function handleGoogleLogin() {
    window.location.href = `${API_BASE}/auth/google`
  }

  const tickerItems = useMemo(() => {
    const items: string[] = []
    if (topCommanders[0]) items.push(`🏆 ${topCommanders[0].name.toUpperCase()} LEADS THE CAMPAIGN`)
    if (problemCount !== null) items.push(`⚔️ ${problemCount} PROBLEMS LIVE`)
    if (zoneCount !== null) items.push(`🗺️ ${zoneCount} ZONES ON THE MAP`)
    items.push('🚩 CAPTURE · HOLD · REPEAT')
    items.push('🔥 THE FRONT NEVER SLEEPS')
    items.push('⚡ ONE SOLVE CAN FLIP A ZONE')
    return items.length > 0 ? items : ['🚩 CAPTURE · HOLD · REPEAT']
  }, [topCommanders, problemCount, zoneCount])

  return (
    <div className="min-h-screen hud-grid-bg flex flex-col overflow-hidden relative">
      {/* nav */}
      <nav className="relative z-20 flex items-center justify-between px-6 md:px-10 py-5">
        <p
          className="text-lg tracking-wide text-slate-100"
          style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 700 }}
        >
          Code<span className="text-amber-400">Craft</span>
        </p>
        <div
          className="hidden sm:flex items-center gap-8 text-sm text-slate-400 uppercase tracking-wide"
          style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 600 }}
        >
          <span className="text-slate-100 border-b-2 border-amber-500 pb-1">Home</span>
          <span className="hover:text-slate-200 transition-colors cursor-default">Battlefield</span>
          <span className="hover:text-slate-200 transition-colors cursor-default">Territory Map</span>
        </div>
        <div className="flex items-center gap-2">
          <FlavorToggle />
          <span className="hidden md:inline-flex items-center gap-1.5 text-xs text-emerald-400 border border-emerald-600/30 bg-emerald-500/10 rounded-full px-3 py-1.5">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
            </span>
            Live
          </span>
        </div>
      </nav>

      {/* hero */}
      <div className="relative flex-1 flex flex-col items-center justify-center text-center px-6 -mt-10">
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[900px] h-[900px] rounded-full bg-amber-500/10 blur-3xl" />
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[1100px] h-40 bg-gradient-to-t from-amber-500/25 via-orange-500/10 to-transparent blur-2xl" />
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[700px] h-1 bg-amber-400/60 blur-md" />
        </div>

        <div className="relative z-10 animate-fade-in-up">
          <p
            className="text-xs tracking-[0.3em] text-amber-500 uppercase mb-4"
            style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 700 }}
          >
            Now Live
          </p>
          <h1
            className="text-5xl sm:text-7xl leading-[0.95] mb-6"
            style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, color: '#f1f5f9' }}
          >
            CLAIM YOUR
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-orange-400 to-amber-300">
              TERRITORY
            </span>
          </h1>
          <p className="text-slate-400 text-base max-w-lg mx-auto mb-8">{greeting}</p>

          {error === 'domain_not_allowed' && (
            <p className="text-sm text-red-400 mb-6 bg-red-950/40 border border-red-800/50 rounded-lg py-2 px-4 inline-block">
              Only @thapar.edu accounts can sign in. Please try again with your institutional email.
            </p>
          )}

          <div className="flex flex-wrap items-center justify-center gap-3 mb-3">
            <button
              onClick={handleGoogleLogin}
              className="flex items-center justify-center gap-3 rounded-full px-6 py-3 text-sm font-semibold bg-slate-100 text-slate-900 hover:bg-white transition-all hover:scale-[1.03] active:scale-[0.98] animate-glow-pulse"
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
            <button
              onClick={() => setShowCommanders((s) => !s)}
              className="rounded-full px-6 py-3 text-sm font-semibold border border-slate-600 text-slate-200 hover:border-amber-500/60 hover:text-amber-300 transition-colors"
            >
              {showCommanders ? 'Hide' : 'View'} Top Commanders
            </button>
          </div>
          <p className="text-xs text-slate-500 mb-6">New commander? Signing in enlists you automatically.</p>

          {showCommanders && (
            <div className="max-w-sm mx-auto rounded-xl border border-slate-800 bg-slate-900/80 backdrop-blur p-4 animate-pop-in text-left">
              {topCommanders.length === 0 ? (
                <p className="text-slate-500 text-sm italic text-center">No scores yet — could be you.</p>
              ) : (
                <ol className="space-y-1.5">
                  {topCommanders.map((c, i) => (
                    <li key={c.userId} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 text-slate-200">
                        <span>{medal[i] ?? `#${i + 1}`}</span>
                        <span>{c.name}</span>
                        {flavorTextEnabled && (
                          <span className="text-[10px] text-amber-400/80 uppercase tracking-wide">
                            {rankTitle(i + 1)}
                          </span>
                        )}
                      </span>
                      <span className="font-mono text-emerald-400">{c.score.toFixed(1)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </div>
      </div>

      {/* marquee ticker */}
      <div className="relative z-10 border-t border-amber-600/20 bg-black/50 backdrop-blur py-3 overflow-hidden">
        <div className="flex w-max animate-marquee">
          {[...tickerItems, ...tickerItems].map((item, i) => (
            <span
              key={i}
              className="mx-6 text-xs text-slate-400 uppercase tracking-widest whitespace-nowrap"
              style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 600 }}
            >
              {item}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

export default LoginPage
