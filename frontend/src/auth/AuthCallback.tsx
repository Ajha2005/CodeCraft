import { useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { request } from '../lib/http'
import { useAuth } from './useAuth'

/**
 * Where Google sign-in lands. The server redirects here with a one-time code
 * (never the access token itself, which would end up in the address bar, the
 * browser history and server logs); the code is traded for the token over a POST.
 */
function AuthCallback() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { login } = useAuth()
  const hasRun = useRef(false)

  useEffect(() => {
    if (hasRun.current) return
    hasRun.current = true

    const code = searchParams.get('code')
    // The code is single-use, but there is no reason to leave it in the address bar or the history.
    window.history.replaceState(null, '', window.location.pathname)

    if (!code) {
      navigate('/login', { replace: true })
      return
    }

    request<{ accessToken: string }>('/auth/exchange', { method: 'POST', body: { code }, auth: false })
      .then((data) => {
        login(data.accessToken)
        navigate('/', { replace: true })
      })
      .catch(() => navigate('/login?error=google_auth_failed', { replace: true }))
  }, [searchParams, login, navigate])

  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-sm opacity-70">Signing you in…</p>
    </div>
  )
}

export default AuthCallback
