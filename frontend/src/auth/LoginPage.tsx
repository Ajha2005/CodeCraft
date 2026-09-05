import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { LOGIN_GREETINGS, pickDaily } from '../lib/flavorText'
import { useAuth } from './AuthContext'

const API_BASE = 'http://localhost:3000'

function LoginPage() {
  const [searchParams] = useSearchParams()
  const error = searchParams.get('error')
  const { flavorTextEnabled } = useAuth()
  const greeting = useMemo(
    () => (flavorTextEnabled ? pickDaily(LOGIN_GREETINGS) : 'Welcome back'),
    [flavorTextEnabled],
  )

  function handleGoogleLogin() {
    window.location.href = `${API_BASE}/auth/google`
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center bg-[#0A0E14]"
      style={{
        backgroundImage:
          'repeating-linear-gradient(135deg, #0A0E14, #0A0E14 12px, #10161F 12px, #10161F 24px)',
      }}
    >
      <div className="max-w-sm w-full text-center p-8 rounded-xl border border-slate-700 bg-black/50 backdrop-blur">
        <p
          className="text-xs tracking-[0.2em] text-amber-500 mb-3 uppercase"
          style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 700 }}
        >
          CodeCraft — Territory Control
        </p>
        <h1 className="text-xl font-semibold mb-2" style={{ color: '#f1f5f9' }}>
          {greeting}
        </h1>
        <p className="text-sm text-slate-400 mb-8">
          Sign in with your @thapar.edu account to continue.
        </p>

        {error === 'domain_not_allowed' && (
          <p className="text-sm text-red-400 mb-4">
            Only @thapar.edu accounts can sign in. Please try again with your institutional email.
          </p>
        )}

        <button
          onClick={handleGoogleLogin}
          className="w-full flex items-center justify-center gap-3 rounded px-4 py-2 text-sm font-medium bg-slate-100 text-slate-900 hover:bg-white transition"
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
      </div>
    </div>
  )
}

export default LoginPage
