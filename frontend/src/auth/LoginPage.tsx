import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { LOGIN_GREETINGS, pickDaily, rankTitle } from '../lib/flavorText'
import { useAuth } from './AuthContext'

const API_BASE = 'http://localhost:3000'

interface TopCommander {
  userId: string
  name: string
  score: number
}

function LoginPage() {
  const [searchParams] = useSearchParams()
  const error = searchParams.get('error')
  const { flavorTextEnabled } = useAuth()
  const greeting = useMemo(
    () => (flavorTextEnabled ? pickDaily(LOGIN_GREETINGS) : 'Welcome back'),
    [flavorTextEnabled],
  )

  const [topCommanders, setTopCommanders] = useState<TopCommander[]>([])
  const [problemCount, setProblemCount] = useState<number | null>(null)
  const [zoneCount, setZoneCount] = useState<number | null>(null)

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

  const medal = ['🥇', '🥈', '🥉']

  return (
    <div className="min-h-screen hud-grid-bg flex items-center justify-center p-6 overflow-hidden relative">
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-32 left-1/4 w-96 h-96 rounded-full bg-amber-500/10 blur-3xl" />
        <div className="absolute -bottom-32 right-1/4 w-96 h-96 rounded-full bg-cyan-500/10 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md z-10 animate-fade-in-up">
        <div className="flex items-center justify-center gap-2 mb-6">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <p
            className="text-[11px] tracking-[0.25em] text-slate-400 uppercase"
            style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 600 }}
          >
            Live campaign — CodeCraft Territory Control
          </p>
        </div>

        {(problemCount !== null || zoneCount !== null) && (
          <div className="grid grid-cols-3 gap-2 mb-5">
            <StatChip label="Problems" value={problemCount ?? '—'} accent="text-cyan-400" />
            <StatChip label="Zones" value={zoneCount ?? '—'} accent="text-amber-400" />
            <StatChip
              label="Top Commander"
              value={topCommanders[0]?.name ?? '—'}
              accent="text-fuchsia-400"
              small
            />
          </div>
        )}

        <div className="relative rounded-2xl border border-amber-600/30 bg-black/60 backdrop-blur-xl p-8 shadow-[0_0_60px_-15px_rgba(201,162,39,0.35)]">
          {/* HUD corner brackets */}
          <span className="absolute -top-px -left-px w-6 h-6 border-t-2 border-l-2 border-amber-500/70 rounded-tl-2xl" />
          <span className="absolute -top-px -right-px w-6 h-6 border-t-2 border-r-2 border-amber-500/70 rounded-tr-2xl" />
          <span className="absolute -bottom-px -left-px w-6 h-6 border-b-2 border-l-2 border-amber-500/70 rounded-bl-2xl" />
          <span className="absolute -bottom-px -right-px w-6 h-6 border-b-2 border-r-2 border-amber-500/70 rounded-br-2xl" />

          <div className="text-center">
            <p
              className="text-xs tracking-[0.2em] text-amber-500 mb-3 uppercase"
              style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 700 }}
            >
              CodeCraft — Territory Control
            </p>
            <h1
              className="text-2xl mb-2 leading-tight"
              style={{ color: '#f1f5f9', fontFamily: "'Rajdhani', sans-serif", fontWeight: 700 }}
            >
              {greeting}
            </h1>
            <p className="text-sm text-slate-400 mb-7">
              Sign in with your @thapar.edu account to continue.
            </p>

            {error === 'domain_not_allowed' && (
              <p className="text-sm text-red-400 mb-4 bg-red-950/40 border border-red-800/50 rounded-lg py-2 px-3">
                Only @thapar.edu accounts can sign in. Please try again with your institutional email.
              </p>
            )}

            <button
              onClick={handleGoogleLogin}
              className="w-full flex items-center justify-center gap-3 rounded-lg px-4 py-3 text-sm font-semibold bg-slate-100 text-slate-900 hover:bg-white transition-all hover:scale-[1.02] active:scale-[0.98] animate-glow-pulse"
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
            <p className="text-xs text-slate-500 mt-4">
              New commander? Signing in enlists you automatically.
            </p>
          </div>
        </div>

        {topCommanders.length > 0 && (
          <div
            className="mt-5 rounded-xl border border-slate-800 bg-slate-900/70 backdrop-blur p-4 animate-fade-in-up"
            style={{ animationDelay: '150ms' }}
          >
            <p
              className="text-[11px] tracking-[0.2em] text-slate-400 uppercase mb-2"
              style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 700 }}
            >
              Top Commanders
            </p>
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
          </div>
        )}
      </div>
    </div>
  )
}

function StatChip({
  label,
  value,
  accent,
  small,
}: {
  label: string
  value: string | number
  accent: string
  small?: boolean
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 backdrop-blur px-3 py-2 text-center">
      <p className={`font-mono font-bold ${accent} ${small ? 'text-xs truncate' : 'text-lg'}`}>{value}</p>
      <p className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</p>
    </div>
  )
}

export default LoginPage
