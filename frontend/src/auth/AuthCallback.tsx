import { useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from './useAuth'
import { takeReturnTo } from './returnTo'

function AuthCallback() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { login } = useAuth()
  const hasRun = useRef(false)

  useEffect(() => {
    if (hasRun.current) return
    hasRun.current = true

    const token = searchParams.get('token')

    if (!token) {
      navigate('/login', { replace: true })
      return
    }

    login(token)
    navigate(takeReturnTo(), { replace: true })
  }, [searchParams, login, navigate])

  return (
    <div className="hud-grid-bg flex min-h-dvh items-center justify-center">
      <p className="font-display relative z-10 text-sm font-bold uppercase tracking-[0.3em] text-cyan-300">Signing you in…</p>
    </div>
  )
}

export default AuthCallback
