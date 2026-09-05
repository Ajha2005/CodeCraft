import { useEffect, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import confetti from 'canvas-confetti'
import { useAuth } from './auth/AuthContext'
import { ToastStack } from './components/ToastStack'
import { StreakBadge } from './components/StreakBadge'
import { useToasts } from './lib/useToasts'
import { fetchUserRank } from './api/client'
import {
  DIFFICULTY_TAG,
  EMPTY_PROBLEM_LIST,
  JUDGE_RUNNING,
  PROBLEM_HOVER_REMATCH,
  PROBLEM_HOVER_UNSOLVED,
  pickRandom,
  rankTitle,
  streakToast,
  verdictFlavor,
} from './lib/flavorText'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000'

const DIFFICULTY_STYLE: Record<string, { text: string; border: string; bg: string; dot: string }> = {
  Easy: { text: 'text-emerald-400', border: 'border-emerald-500/40', bg: 'bg-emerald-500/10', dot: 'bg-emerald-500' },
  Medium: { text: 'text-amber-400', border: 'border-amber-500/40', bg: 'bg-amber-500/10', dot: 'bg-amber-500' },
  Hard: { text: 'text-rose-400', border: 'border-rose-500/40', bg: 'bg-rose-500/10', dot: 'bg-rose-500' },
}
const DEFAULT_DIFFICULTY_STYLE = { text: 'text-slate-400', border: 'border-slate-600/40', bg: 'bg-slate-500/10', dot: 'bg-slate-500' }

interface ScoreResult {
  difficultyWeight: number
  correctness: number
  attemptsPenalty: number
  timeEfficiency: number
  totalScore: number
}

interface ProblemSummary {
  id: number
  title: string
  difficultyLevel: string
}

interface ProblemDetail extends ProblemSummary {
  description: string
  examples: { input: unknown; output: unknown }[]
  constraints: string[]
  testCases: { input: unknown; expected_output: unknown }[]
  boilerplate: Record<string, string>
}

interface ProblemListResponse {
  items: ProblemSummary[]
  total: number
  limit: number
  offset: number
}

interface SubmissionResult {
  id: string
  verdict: string
  totalPassed: number
  totalTests: number
  pointsAwarded?: boolean
  noPointsReason?: string | null
}

type ProblemStatus = 'AC' | 'ATTEMPTED'

function ProblemsPage() {
  const { user, token, logout, flavorTextEnabled } = useAuth()
  const { toasts, push, dismiss } = useToasts()

  const [problems, setProblems] = useState<ProblemSummary[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [limit] = useState(20)
  const [difficulty, setDifficulty] = useState('')
  const [selectedProblem, setSelectedProblem] = useState<ProblemDetail | null>(null)
  const [language, setLanguage] = useState('python')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [problemStatus, setProblemStatus] = useState<Record<number, ProblemStatus>>({})
  const [rank, setRank] = useState<number | null>(null)

  const [code, setCode] = useState('def solve(*args, **kwargs):\n    pass\n')
  const [submitting, setSubmitting] = useState(false)
  const [submissionResult, setSubmissionResult] = useState<SubmissionResult | null>(null)
  const [scoreResult, setScoreResult] = useState<ScoreResult | null>(null)
  const [submitError, setSubmitError] = useState('')
  const [runningLine, setRunningLine] = useState('')
  const acStreakRef = useRef(0)

  useEffect(() => {
    if (!user) return
    fetch(`${API_BASE}/submissions/status/${user.userId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : {}))
      .then((data: Record<number, ProblemStatus>) => setProblemStatus(data))
      .catch(() => {})

    fetchUserRank(user.userId)
      .then((data) => setRank(data.rank))
      .catch(() => {})
  }, [user, token])

  useEffect(() => {
    if (selectedProblem) return

    setLoading(true)
    setError('')

    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    })
    if (difficulty) params.set('difficulty', difficulty)

    fetch(`${API_BASE}/problems?${params}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed: ${res.status}`)
        return res.json()
      })
      .then((data: ProblemListResponse) => {
        setProblems(data.items)
        setTotal(data.total)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [offset, limit, difficulty, selectedProblem])

  function openProblem(id: number) {
    setLoading(true)
    setError('')
    setSubmissionResult(null)
    setScoreResult(null)
    setSubmitError('')
    setCode('def solve(*args, **kwargs):\n    pass\n')

    fetch(`${API_BASE}/problems/${id}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed: ${res.status}`)
        return res.json()
      })
      .then((data: ProblemDetail) => {
        setSelectedProblem(data)
        setCode(data.boilerplate[language] || 'def solve(*args, **kwargs):\n    pass\n')
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }

  function fireCelebration(submissionId: string) {
    confetti({
      particleCount: 150,
      spread: 90,
      origin: { y: 0.6 },
    })
    fetch(`${API_BASE}/scoring/submission/${submissionId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data: ScoreResult) => setScoreResult(data))
      .catch(() => {})
  }

  function pollSubmission(id: string, problemId: number) {
    const runningInterval = setInterval(() => {
      setRunningLine(pickRandom(JUDGE_RUNNING))
    }, 1400)
    setRunningLine(pickRandom(JUDGE_RUNNING))

    const interval = setInterval(() => {
      fetch(`${API_BASE}/submissions/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((res) => res.json())
        .then((data: SubmissionResult) => {
          setSubmissionResult(data)
          if (data.verdict !== 'PENDING') {
            clearInterval(interval)
            clearInterval(runningInterval)

            if (data.verdict === 'AC') {
              fireCelebration(data.id)
              setProblemStatus((prev) => ({ ...prev, [problemId]: 'AC' }))
              acStreakRef.current += 1
              if (acStreakRef.current >= 2 && flavorTextEnabled) {
                push(streakToast(acStreakRef.current), 'success')
              }
            } else {
              setProblemStatus((prev) =>
                prev[problemId] === 'AC' ? prev : { ...prev, [problemId]: 'ATTEMPTED' },
              )
              acStreakRef.current = 0
            }
          }
        })
        .catch(() => {
          clearInterval(interval)
          clearInterval(runningInterval)
        })
    }, 1000)
  }

  function handleSubmit() {
    if (!selectedProblem || !user) return
    setSubmitting(true)
    setSubmitError('')
    setSubmissionResult(null)
    setScoreResult(null)

    fetch(`${API_BASE}/submissions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        userId: user.userId,
        problemId: selectedProblem.id,
        language,
        code,
      }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed: ${res.status}`)
        return res.json()
      })
      .then((data: SubmissionResult) => {
        setSubmissionResult(data)
        pollSubmission(data.id, selectedProblem.id)
      })
      .catch((err) => setSubmitError(err.message))
      .finally(() => setSubmitting(false))
  }

  function verdictStyle(verdict: string) {
    if (verdict === 'AC') return { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/40' }
    if (verdict === 'PENDING') return { text: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/40' }
    return { text: 'text-rose-400', bg: 'bg-rose-500/10', border: 'border-rose-500/40' }
  }

  const solvedCount = Object.values(problemStatus).filter((s) => s === 'AC').length
  const solvedPct = total > 0 ? Math.min(100, Math.round((solvedCount / total) * 100)) : 0

  const header = (
    <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
      <div className="flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-full bg-gradient-to-br from-cyan-500 to-teal-600 flex items-center justify-center text-sm font-bold text-white shadow-lg"
          style={{ fontFamily: "'Rajdhani', sans-serif" }}
        >
          {(user?.email?.[0] ?? '?').toUpperCase()}
        </div>
        <div>
          <p className="text-sm text-slate-200">{user?.email}</p>
          <div className="flex items-center gap-2 text-xs">
            {user && <StreakBadge userId={user.userId} />}
            {flavorTextEnabled && rank && (
              <span className="text-cyan-400 font-semibold">{rankTitle(rank)}</span>
            )}
          </div>
        </div>
      </div>
      <button
        onClick={logout}
        className="text-xs px-3 py-1.5 rounded border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors"
      >
        Logout
      </button>
    </div>
  )

  if (selectedProblem) {
    const diffStyle = DIFFICULTY_STYLE[selectedProblem.difficultyLevel] ?? DEFAULT_DIFFICULTY_STYLE
    const vStyle = submissionResult ? verdictStyle(submissionResult.verdict) : null

    return (
      <div className="min-h-screen hud-grid-bg">
        <div className="max-w-5xl mx-auto p-6 text-left">
          {header}
          <ToastStack toasts={toasts} dismiss={dismiss} />
          <button
            onClick={() => setSelectedProblem(null)}
            className="mb-4 text-sm text-slate-400 hover:text-slate-200 transition-colors"
          >
            ← Back to battlefield
          </button>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 backdrop-blur p-6 mb-6 animate-fade-in-up">
            <div className="flex items-center gap-2 mb-2">
              <h1 className="text-2xl font-bold text-slate-100" style={{ fontFamily: "'Rajdhani', sans-serif" }}>
                {selectedProblem.title}
              </h1>
              <span className={`px-2 py-0.5 rounded text-xs border ${diffStyle.border} ${diffStyle.bg} ${diffStyle.text} uppercase tracking-wide font-semibold`}>
                {selectedProblem.difficultyLevel}
              </span>
              {flavorTextEnabled && DIFFICULTY_TAG[selectedProblem.difficultyLevel] && (
                <span className="px-2 py-0.5 rounded text-xs border border-cyan-600/40 text-cyan-400 uppercase tracking-wide">
                  {DIFFICULTY_TAG[selectedProblem.difficultyLevel]}
                </span>
              )}
            </div>
            <p className="mb-6 whitespace-pre-wrap text-slate-300 text-sm leading-relaxed">
              {selectedProblem.description}
            </p>

            <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wide mb-2">Examples</h2>
            {selectedProblem.examples.map((ex, i) => (
              <pre
                key={i}
                className="bg-black/40 border border-slate-800 rounded-lg p-3 mb-3 text-sm overflow-x-auto text-slate-300 font-mono"
              >
{`Input: ${JSON.stringify(ex.input)}\nOutput: ${JSON.stringify(ex.output)}`}
              </pre>
            ))}

            <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wide mb-2 mt-4">Constraints</h2>
            <ul className="list-disc pl-5 text-slate-400">
              {selectedProblem.constraints.map((c, i) => (
                <li key={i} className="text-sm">{c}</li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 backdrop-blur p-6 animate-fade-in-up" style={{ animationDelay: '100ms' }}>
            <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wide mb-3">Deploy Your Solution</h2>

            <div className="flex items-center gap-2 mb-3">
              {(['python', 'c++'] as const).map((lang) => (
                <button
                  key={lang}
                  onClick={() => {
                    setLanguage(lang)
                    setCode(selectedProblem.boilerplate[lang] || '')
                  }}
                  className={`px-3 py-1 rounded text-xs font-medium border transition-colors ${
                    language === lang
                      ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300'
                      : 'border-slate-700 text-slate-400 hover:border-slate-500'
                  }`}
                >
                  {lang === 'python' ? 'Python' : 'C++'}
                </button>
              ))}
            </div>
            <div className="border border-slate-800 rounded-lg overflow-hidden mb-4 shadow-lg">
              <Editor
                height="300px"
                language={language === 'c++' ? 'cpp' : language}
                value={code}
                onChange={(value) => setCode(value || '')}
                theme="vs-dark"
                options={{ fontSize: 14, minimap: { enabled: false } }}
              />
            </div>

            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="px-5 py-2.5 rounded-lg bg-gradient-to-r from-cyan-500 to-teal-600 text-slate-950 text-sm font-bold disabled:opacity-50 mb-4 hover:scale-[1.02] active:scale-[0.98] transition-transform shadow-lg shadow-cyan-900/30"
            >
              {submitting ? 'Deploying…' : '🚀 Deploy Solution'}
            </button>

            {submitError && <p className="text-rose-400 mb-4 text-sm">{submitError}</p>}

            {submissionResult?.verdict === 'PENDING' && flavorTextEnabled && (
              <p className="text-sm text-amber-400/80 mb-3 animate-pulse">{runningLine}</p>
            )}

            {submissionResult && vStyle && (
              <div className={`rounded-lg border p-4 mb-3 animate-pop-in ${vStyle.border} ${vStyle.bg}`}>
                <p className={`font-bold ${vStyle.text}`}>
                  Verdict: {submissionResult.verdict}
                  {flavorTextEnabled && submissionResult.verdict !== 'PENDING' && (
                    <span className="ml-2 font-normal text-slate-400">
                      — {verdictFlavor(submissionResult.verdict)}
                    </span>
                  )}
                </p>
                <p className="text-sm text-slate-400 mt-1">
                  Passed: {submissionResult.totalPassed} / {submissionResult.totalTests}
                </p>

                {submissionResult.verdict === 'AC' &&
                  submissionResult.pointsAwarded === false && (
                    <p className="text-amber-400 text-sm mt-2">
                      {submissionResult.noPointsReason === 'ALREADY_SOLVED'
                        ? "You've already earned points for this problem — no additional territory or score awarded."
                        : submissionResult.noPointsReason === 'DAILY_LIMIT'
                        ? "Daily submission limit reached — this solve won't count toward score today."
                        : 'No points awarded for this submission.'}
                    </p>
                  )}
              </div>
            )}
            {submissionResult?.verdict === 'AC' && scoreResult && (
              <div className="mt-2 rounded-xl p-4 bg-gradient-to-br from-emerald-950 to-slate-900 border border-emerald-500/40 shadow-[0_0_30px_-10px_rgba(16,185,129,0.5)] animate-pop-in">
                <p className="text-lg font-bold text-emerald-400">
                  {flavorTextEnabled ? '🚩 Territory captured!' : '🎉 Accepted!'} +{scoreResult.totalScore.toFixed(1)} pts
                </p>
                <div className="text-sm text-slate-400 mt-1 space-y-0.5">
                  <p>Difficulty weight: {scoreResult.difficultyWeight}</p>
                  <p>Attempts penalty: -{scoreResult.attemptsPenalty.toFixed(1)}</p>
                  <p>Time efficiency bonus: +{scoreResult.timeEfficiency.toFixed(1)}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen hud-grid-bg">
      <div className="max-w-4xl mx-auto p-6 text-left">
        {header}
        <ToastStack toasts={toasts} dismiss={dismiss} />

        <div className="mb-6 animate-fade-in-up">
          <h1
            className="text-3xl font-bold mb-1"
            style={{ color: '#f1f5f9', fontFamily: "'Rajdhani', sans-serif" }}
          >
            {flavorTextEnabled ? '⚔️ Pick your battlefield' : 'Problems'}
          </h1>
          <p className="text-sm text-slate-400 mb-3">
            {solvedCount} / {total} zones cleared
          </p>
          <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-teal-500 to-emerald-500 transition-all duration-700"
              style={{
                width: `${solvedPct}%`,
                backgroundSize: '200% 100%',
                animation: 'shimmer-bar 3s linear infinite',
              }}
            />
          </div>
        </div>

        <div className="flex gap-2 mb-6 flex-wrap">
          {(['', 'Easy', 'Medium', 'Hard'] as const).map((d) => {
            const style = d ? DIFFICULTY_STYLE[d] : null
            const active = difficulty === d
            return (
              <button
                key={d || 'all'}
                onClick={() => {
                  setDifficulty(d)
                  setOffset(0)
                }}
                className={`px-3 py-1.5 rounded-full text-sm border font-medium transition-colors ${
                  active
                    ? d
                      ? `${style!.bg} ${style!.border} ${style!.text}`
                      : 'bg-slate-100 text-slate-900 border-slate-100'
                    : 'border-slate-700 text-slate-400 hover:border-slate-500'
                }`}
              >
                {d || 'All'}
                {d && flavorTextEnabled && ` · ${DIFFICULTY_TAG[d]}`}
              </button>
            )
          })}
        </div>

        {error && <p className="text-rose-400 mb-4 text-sm">{error}</p>}
        {loading && <p className="mb-4 text-slate-500 text-sm">Loading…</p>}

        {!loading && !error && problems.length === 0 && (
          <p className="mb-4 text-slate-500 italic text-sm">
            {flavorTextEnabled ? EMPTY_PROBLEM_LIST : 'No problems found.'}
          </p>
        )}

        <div className="grid sm:grid-cols-2 gap-3 mb-6">
          {problems.map((p, i) => {
            const status = problemStatus[p.id]
            const style = DIFFICULTY_STYLE[p.difficultyLevel] ?? DEFAULT_DIFFICULTY_STYLE
            const hoverTitle = flavorTextEnabled
              ? status === 'AC'
                ? undefined
                : status === 'ATTEMPTED'
                ? pickRandom(PROBLEM_HOVER_REMATCH)
                : pickRandom(PROBLEM_HOVER_UNSOLVED)
              : undefined

            return (
              <button
                key={p.id}
                onClick={() => openProblem(p.id)}
                title={hoverTitle}
                style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}
                className={`group relative text-left rounded-xl border bg-slate-900/60 backdrop-blur p-4 transition-all hover:-translate-y-0.5 hover:shadow-lg animate-fade-in-up ${
                  status === 'AC'
                    ? 'border-emerald-600/40 hover:shadow-emerald-900/30'
                    : 'border-slate-800 hover:border-slate-600 hover:shadow-black/30'
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className={`w-1.5 h-1.5 rounded-full mt-1.5 ${style.dot}`} />
                  <span className="flex-1 text-slate-100 font-medium text-sm leading-snug">
                    {p.title}
                  </span>
                  {status === 'AC' && <span className="text-emerald-400 text-sm">🚩</span>}
                  {status === 'ATTEMPTED' && <span className="text-amber-400 text-sm">⚔️</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-[10px] border ${style.border} ${style.bg} ${style.text} uppercase tracking-wide font-semibold`}>
                    {p.difficultyLevel}
                  </span>
                  {flavorTextEnabled && DIFFICULTY_TAG[p.difficultyLevel] && (
                    <span className="text-[10px] text-slate-500 uppercase tracking-wide">
                      {DIFFICULTY_TAG[p.difficultyLevel]}
                    </span>
                  )}
                </div>
              </button>
            )
          })}
        </div>

        <div className="flex justify-between items-center text-sm">
          <button
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - limit))}
            className="px-3 py-1.5 rounded border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 disabled:opacity-30 transition-colors"
          >
            Previous
          </button>
          <span className="text-slate-500">
            {offset + 1}–{Math.min(offset + limit, total)} of {total}
          </span>
          <button
            disabled={offset + limit >= total}
            onClick={() => setOffset(offset + limit)}
            className="px-3 py-1.5 rounded border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 disabled:opacity-30 transition-colors"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}

export default ProblemsPage
