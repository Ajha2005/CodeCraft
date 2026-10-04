import { useEffect, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import confetti from 'canvas-confetti'
import { useAuth } from './auth/AuthContext'
import { ToastStack } from './components/ToastStack'
import { useToasts } from './lib/useToasts'
import { usePlayerStats } from './lib/playerStatsContext'
import { sfx } from './lib/sfx'
import { AnimatedNumber } from './components/ui/AnimatedNumber'
import { Icon, type IconName } from './components/ui/Icon'
import { LevelBadge } from './components/ui/LevelBadge'
import { Pips } from './components/ui/Pips'
import { ProgressRing } from './components/ui/ProgressRing'
import { XPBar } from './components/ui/XPBar'
import {
  EMPTY_PROBLEM_LIST,
  JUDGE_RUNNING,
  PROBLEM_HOVER_REMATCH,
  PROBLEM_HOVER_UNSOLVED,
  pickRandom,
  streakToast,
  verdictFlavor,
} from './lib/flavorText'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000'

interface DifficultyMeta {
  text: string
  border: string
  bg: string
  accent: string
  icon: IconName
  /** Base XP: the scoring DifficultyWeight x 10. */
  xp: number
}

const DIFFICULTY: Record<string, DifficultyMeta> = {
  Easy: { text: 'text-emerald-400', border: 'border-emerald-500/40', bg: 'bg-emerald-500/10', accent: '#34d399', icon: 'shield', xp: 100 },
  Medium: { text: 'text-amber-400', border: 'border-amber-500/40', bg: 'bg-amber-500/10', accent: '#fbbf24', icon: 'swords', xp: 250 },
  Hard: { text: 'text-rose-400', border: 'border-rose-500/40', bg: 'bg-rose-500/10', accent: '#fb7185', icon: 'skull', xp: 500 },
}
const DEFAULT_DIFFICULTY: DifficultyMeta = {
  text: 'text-slate-400',
  border: 'border-slate-600/40',
  bg: 'bg-slate-500/10',
  accent: '#94a3b8',
  icon: 'flag',
  xp: 0,
}

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

function DifficultyBadge({ level }: { level: string }) {
  const meta = DIFFICULTY[level] ?? DEFAULT_DIFFICULTY
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-display text-[0.7rem] font-bold uppercase tracking-[0.12em] ${meta.border} ${meta.bg} ${meta.text}`}
    >
      <Icon name={meta.icon} className="h-3 w-3" />
      {level}
    </span>
  )
}

function verdictStyle(verdict: string) {
  if (verdict === 'AC') return { text: 'text-emerald-300', border: 'border-emerald-500/50', bg: 'from-emerald-950/70 to-slate-950/60', color: '#34d399' }
  if (verdict === 'PENDING') return { text: 'text-amber-300', border: 'border-amber-500/50', bg: 'from-amber-950/50 to-slate-950/60', color: '#fbbf24' }
  return { text: 'text-rose-300', border: 'border-rose-500/50', bg: 'from-rose-950/60 to-slate-950/60', color: '#fb7185' }
}

function ProblemsPage() {
  const { user, token, flavorTextEnabled } = useAuth()
  const { stats, refresh: refreshStats } = usePlayerStats()
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
  }, [user, token])

  useEffect(() => {
    if (selectedProblem) return

    let ignore = false

    async function loadProblems() {
      setLoading(true)
      setError('')

      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
      })
      if (difficulty) params.set('difficulty', difficulty)

      try {
        const res = await fetch(`${API_BASE}/problems?${params}`)
        if (!res.ok) throw new Error(`Request failed: ${res.status}`)
        const data: ProblemListResponse = await res.json()
        if (ignore) return
        setProblems(data.items)
        setTotal(data.total)
      } catch (err) {
        if (!ignore) setError((err as Error).message)
      } finally {
        if (!ignore) setLoading(false)
      }
    }

    loadProblems()
    return () => {
      ignore = true
    }
  }, [offset, limit, difficulty, selectedProblem])

  function openProblem(id: number) {
    sfx.play('click')
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
        window.scrollTo({ top: 0, behavior: 'smooth' })
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }

  function fireCelebration(submissionId: string) {
    sfx.play('win')
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
      .finally(() => {
        // The score is final now: refresh level/XP/streak (and trigger the
        // level-up celebration if this solve crossed a threshold).
        void refreshStats()
      })
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
              sfx.play('error')
              setProblemStatus((prev) => (prev[problemId] === 'AC' ? prev : { ...prev, [problemId]: 'ATTEMPTED' }))
              acStreakRef.current = 0
            }
          }
        })
        .catch(() => {
          clearInterval(interval)
          clearInterval(runningInterval)
        })
    }, 2000)
  }

  function handleSubmit() {
    if (!selectedProblem || !user) return
    sfx.play('click')
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

  const solvedCount = Object.values(problemStatus).filter((s) => s === 'AC').length
  const solvedPct = total > 0 ? Math.min(1, solvedCount / total) : 0
  const name = user?.name?.trim()?.split(/\s+/)[0] || user?.email?.split('@')[0] || 'Commander'

  // ======================================================== mission briefing
  if (selectedProblem) {
    const meta = DIFFICULTY[selectedProblem.difficultyLevel] ?? DEFAULT_DIFFICULTY
    const verdict = submissionResult ? verdictStyle(submissionResult.verdict) : null
    const judging = submissionResult?.verdict === 'PENDING'
    const cleared = problemStatus[selectedProblem.id] === 'AC'

    return (
      <div className="hud-grid-bg min-h-[calc(100dvh-var(--nav-h))] flex-1">
        <div className="relative z-10 mx-auto max-w-[88rem] px-4 py-6 text-left md:px-8 md:py-8">
          <ToastStack toasts={toasts} dismiss={dismiss} placement="top-right" />

          <button
            onClick={() => setSelectedProblem(null)}
            className="group mb-4 inline-flex items-center gap-2 text-sm font-semibold text-slate-400 transition-colors hover:text-cyan-300"
          >
            <Icon name="arrowLeft" className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
            {flavorTextEnabled ? 'Back to the quest board' : 'Back to problems'}
          </button>

          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
            {/* ------------------------------------------------ briefing */}
            <section className="hud-panel p-5 md:p-6 animate-fade-in-up">
              <div className="flex flex-wrap items-center gap-2">
                <DifficultyBadge level={selectedProblem.difficultyLevel} />
                <span className="inline-flex items-center gap-1 rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 font-display text-[0.7rem] font-bold uppercase tracking-[0.12em] text-amber-300">
                  <Icon name="bolt" className="h-3 w-3" />+{meta.xp} XP base
                </span>
                {cleared && (
                  <span className="inline-flex items-center gap-1 rounded-md border border-emerald-400/40 bg-emerald-400/10 px-2 py-0.5 font-display text-[0.7rem] font-bold uppercase tracking-[0.12em] text-emerald-300">
                    <Icon name="check" className="h-3 w-3" />
                    Cleared
                  </span>
                )}
              </div>
              <h1 className="font-display mt-3 text-3xl font-bold leading-tight tracking-wide text-slate-50 md:text-4xl">{selectedProblem.title}</h1>

              <p className="mt-4 whitespace-pre-wrap text-[0.95rem] leading-relaxed text-slate-300">{selectedProblem.description}</p>

              <h2 className="hud-label mb-2 mt-6 text-cyan-300">Examples</h2>
              <div className="space-y-2.5">
                {selectedProblem.examples.map((ex, i) => (
                  <div key={i} className="overflow-hidden rounded-lg border border-slate-700/70 bg-black/40">
                    <div className="grid grid-cols-[4.5rem_1fr] border-b border-slate-800 text-sm">
                      <span className="hud-label !text-[0.62rem] px-3 py-2 text-slate-500">Input</span>
                      <span className="block overflow-x-auto py-2 pr-3 font-mono text-[0.82rem] text-slate-200">{JSON.stringify(ex.input)}</span>
                    </div>
                    <div className="grid grid-cols-[4.5rem_1fr] text-sm">
                      <span className="hud-label !text-[0.62rem] px-3 py-2 text-slate-500">Output</span>
                      <span className="block overflow-x-auto py-2 pr-3 font-mono text-[0.82rem] text-emerald-300">{JSON.stringify(ex.output)}</span>
                    </div>
                  </div>
                ))}
              </div>

              <h2 className="hud-label mb-2 mt-6 text-cyan-300">Constraints</h2>
              <ul className="space-y-1.5">
                {selectedProblem.constraints.map((c, i) => (
                  <li key={i} className="flex gap-2.5 text-sm text-slate-400">
                    <span className="mt-[0.45rem] h-1.5 w-1.5 shrink-0 rotate-45 bg-cyan-400/70" />
                    {c}
                  </li>
                ))}
              </ul>
            </section>

            {/* --------------------------------------------- deploy bay */}
            <section className="space-y-4 lg:sticky lg:top-[calc(var(--nav-h)+1rem)]">
              <div className="hud-panel p-4 md:p-5 animate-fade-in-up" style={{ animationDelay: '90ms' }}>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <h2 className="font-display text-sm font-bold uppercase tracking-[0.18em] text-slate-100">
                    {flavorTextEnabled ? 'Deploy your solution' : 'Your solution'}
                  </h2>
                  <div className="flex rounded-lg border border-slate-700 bg-slate-950/60 p-0.5" role="tablist" aria-label="Language">
                    {(['python', 'c++'] as const).map((lang) => (
                      <button
                        key={lang}
                        role="tab"
                        aria-selected={language === lang}
                        onClick={() => {
                          setLanguage(lang)
                          setCode(selectedProblem.boilerplate[lang] || '')
                        }}
                        className={`rounded-md px-3.5 py-1 text-xs font-bold transition-all ${
                          language === lang ? 'bg-cyan-400/20 text-cyan-200 shadow-[0_0_12px_-3px_rgba(34,211,238,0.7)]' : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {lang === 'python' ? 'Python' : 'C++'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="overflow-hidden rounded-lg border border-slate-700/80 shadow-[0_0_30px_-14px_rgba(34,211,238,0.5)]">
                  <Editor
                    height="420px"
                    language={language === 'c++' ? 'cpp' : language}
                    value={code}
                    onChange={(value) => setCode(value || '')}
                    theme="vs-dark"
                    options={{ fontSize: 14, minimap: { enabled: false }, scrollBeyondLastLine: false, padding: { top: 12 } }}
                  />
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button onClick={handleSubmit} disabled={submitting || judging} className="btn-primary h-11 rounded-lg px-6 text-sm">
                    {submitting || judging ? (
                      <>
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-900/30 border-t-slate-900" />
                        {judging ? 'Judging…' : 'Deploying…'}
                      </>
                    ) : (
                      <>
                        <Icon name="rocket" className="h-4 w-4" />
                        {flavorTextEnabled ? 'Deploy solution' : 'Submit'}
                      </>
                    )}
                  </button>
                  {judging && flavorTextEnabled && <p className="text-sm text-amber-300/90 animate-pulse">{runningLine}</p>}
                  {submitError && <p className="text-sm text-rose-400">{submitError}</p>}
                </div>
              </div>

              {submissionResult && verdict && (
                <div className={`hud-panel overflow-hidden bg-gradient-to-br p-5 animate-pop-in ${verdict.bg}`} style={{ borderColor: `${verdict.color}66` }}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="hud-label !text-[0.64rem]">Verdict</p>
                      <p className={`font-display text-3xl font-bold uppercase tracking-wide ${verdict.text}`}>
                        {submissionResult.verdict === 'AC' ? 'Accepted' : submissionResult.verdict}
                      </p>
                      {flavorTextEnabled && !judging && <p className="mt-0.5 text-sm text-slate-400">{verdictFlavor(submissionResult.verdict)}</p>}
                    </div>
                    <div className="text-right">
                      <p className="hud-label !text-[0.64rem]">Tests</p>
                      <p className="font-mono text-2xl font-bold tabular-nums text-slate-100">
                        {submissionResult.totalPassed}
                        <span className="text-slate-500">/{submissionResult.totalTests}</span>
                      </p>
                    </div>
                  </div>
                  {submissionResult.totalTests > 0 && (
                    <Pips
                      className="mt-3"
                      filled={submissionResult.totalPassed}
                      total={Math.min(submissionResult.totalTests, 24)}
                      color={submissionResult.verdict === 'AC' ? '#34d399' : submissionResult.verdict === 'PENDING' ? '#fbbf24' : '#fb7185'}
                    />
                  )}

                  {submissionResult.verdict === 'AC' && submissionResult.pointsAwarded === false && (
                    <p className="mt-3 flex items-start gap-2 text-sm text-amber-300">
                      <Icon name="lock" className="mt-0.5 h-4 w-4 shrink-0" />
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
                <div className="hud-panel overflow-hidden bg-gradient-to-br from-emerald-950/80 to-slate-950/70 p-5 animate-pop-in" style={{ borderColor: 'rgba(52,211,153,0.5)', boxShadow: '0 0 40px -14px rgba(16,185,129,0.6)' }}>
                  <div className="flex items-center gap-4">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-emerald-400/60 bg-emerald-400/15 text-emerald-300 animate-float">
                      <Icon name="flag" filled className="h-7 w-7" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-display text-xl font-bold uppercase tracking-wide text-emerald-300">
                        {flavorTextEnabled ? 'Territory captured!' : 'Accepted!'}
                      </p>
                      <p className="font-mono text-3xl font-bold tabular-nums text-white">
                        +<AnimatedNumber value={scoreResult.totalScore * 10} /> <span className="text-base text-amber-300">XP</span>
                      </p>
                    </div>
                    <LevelBadge level={stats.level.level} size={52} />
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="rounded-lg bg-black/30 p-2">
                      <p className="hud-label !text-[0.58rem]">Difficulty</p>
                      <p className="font-mono text-base font-bold text-slate-100">{scoreResult.difficultyWeight}</p>
                    </div>
                    <div className="rounded-lg bg-black/30 p-2">
                      <p className="hud-label !text-[0.58rem]">Retry penalty</p>
                      <p className="font-mono text-base font-bold text-rose-400">-{scoreResult.attemptsPenalty.toFixed(1)}</p>
                    </div>
                    <div className="rounded-lg bg-black/30 p-2">
                      <p className="hud-label !text-[0.58rem]">Speed bonus</p>
                      <p className="font-mono text-base font-bold text-emerald-400">+{scoreResult.timeEfficiency.toFixed(1)}</p>
                    </div>
                  </div>
                  <XPBar pct={stats.level.pct} className="mt-4" />
                  <p className="mt-1 text-right text-[0.7rem] font-semibold text-slate-400">{stats.level.xpToNext} XP to level {stats.level.level + 1}</p>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    )
  }

  // ============================================================ quest board
  return (
    <div className="hud-grid-bg min-h-[calc(100dvh-var(--nav-h))] flex-1">
      <div className="relative z-10 mx-auto max-w-6xl px-4 py-6 text-left md:px-8 md:py-10">
        <ToastStack toasts={toasts} dismiss={dismiss} placement="top-right" />

        <header className="hud-panel mb-8 grid gap-6 overflow-hidden p-5 md:grid-cols-[1fr_auto] md:p-7 animate-fade-in-up">
          <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-cyan-400/10 blur-3xl" />
          <div className="relative">
            <p className="hud-label text-cyan-300">{flavorTextEnabled ? `Welcome back, ${name}` : 'Problems'}</p>
            <h1 className="font-display mt-1 text-4xl font-bold leading-none tracking-wide text-slate-50 sm:text-5xl">
              {flavorTextEnabled ? 'Quest board' : 'Problems'}
            </h1>
            <p className="mt-3 max-w-lg text-sm leading-relaxed text-slate-400">
              {flavorTextEnabled
                ? 'Pick a front, clear it, and claim the ground. Every accepted solve earns XP and a cell of campus.'
                : 'Solve problems to earn score and territory on the campus map.'}
            </p>
            {stats.daily && (
              <div className="mt-5 w-40" title="Qualifying solves today">
                <p className="hud-label !text-[0.58rem] mb-1">
                  Today · {stats.daily.qualifyingCount}/{stats.daily.cap}
                </p>
                <Pips filled={Math.min(stats.daily.qualifyingCount, stats.daily.cap)} total={stats.daily.cap} />
              </div>
            )}
          </div>

          <div className="relative flex items-center justify-center md:pr-4">
            {difficulty === '' ? (
              <ProgressRing pct={solvedPct} size={132} stroke={10} color="#22d3ee">
                <div className="text-center leading-none">
                  <p className="font-mono text-3xl font-bold tabular-nums text-white">
                    <AnimatedNumber value={solvedCount} />
                  </p>
                  <p className="mt-1 text-[0.68rem] font-semibold uppercase tracking-wide text-slate-400">of {total} cleared</p>
                </div>
              </ProgressRing>
            ) : (
              <div className="text-center">
                <p className="font-mono text-4xl font-bold tabular-nums text-white">{total}</p>
                <p className="hud-label mt-1">{difficulty} quests</p>
              </div>
            )}
          </div>
        </header>

        <div className="mb-6 flex flex-wrap gap-2" role="tablist" aria-label="Difficulty filter">
          {(['', 'Easy', 'Medium', 'Hard'] as const).map((d) => {
            const meta = d ? DIFFICULTY[d] : null
            const active = difficulty === d
            return (
              <button
                key={d || 'all'}
                role="tab"
                aria-selected={active}
                onClick={() => {
                  sfx.play('click')
                  setDifficulty(d)
                  setOffset(0)
                }}
                className="group relative flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-bold transition-all hover:-translate-y-0.5"
                style={
                  active
                    ? {
                        color: meta ? meta.accent : '#04101a',
                        borderColor: meta ? `${meta.accent}99` : '#e2e8f0',
                        background: meta ? `${meta.accent}1f` : 'linear-gradient(135deg,#f1f5f9,#cbd5e1)',
                        boxShadow: meta ? `0 0 22px -6px ${meta.accent}` : '0 0 22px -8px #fff',
                      }
                    : { color: '#94a3b8', borderColor: 'rgba(71,85,105,0.7)', background: 'rgba(15,23,42,0.5)' }
                }
              >
                {meta && <Icon name={meta.icon} className="h-4 w-4" />}
                {d || (flavorTextEnabled ? 'All quests' : 'All')}
                {meta && <span className="text-[0.68rem] font-semibold opacity-60">+{meta.xp} XP</span>}
              </button>
            )
          })}
        </div>

        {error && <p className="mb-4 text-sm text-rose-400">{error}</p>}
        {loading && problems.length === 0 && (
          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl border border-slate-800 bg-slate-900/50" />
            ))}
          </div>
        )}

        {!loading && !error && problems.length === 0 && (
          <p className="mb-4 text-sm italic text-slate-500">{flavorTextEnabled ? EMPTY_PROBLEM_LIST : 'No problems found.'}</p>
        )}

        <div className="mb-8 grid gap-3 sm:grid-cols-2">
          {problems.map((p, i) => {
            const status = problemStatus[p.id]
            const meta = DIFFICULTY[p.difficultyLevel] ?? DEFAULT_DIFFICULTY
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
                style={{ animationDelay: `${Math.min(i, 12) * 40}ms`, ['--accent' as string]: meta.accent }}
                className={`group relative overflow-hidden rounded-xl border bg-slate-900/60 p-4 pl-5 text-left transition-all duration-200 hover:-translate-y-0.5 animate-fade-in-up ${
                  status === 'AC' ? 'border-emerald-500/40 hover:border-emerald-400/70' : 'border-slate-800 hover:border-[color:var(--accent)]'
                }`}
              >
                <span className="absolute inset-y-0 left-0 w-1" style={{ background: meta.accent, opacity: 0.7 }} />
                {status === 'AC' && (
                  <span className="absolute right-3 top-3 flex items-center gap-1 font-display text-[0.64rem] font-bold uppercase tracking-[0.14em] text-emerald-300">
                    <Icon name="check" className="h-3 w-3" />
                    Cleared
                  </span>
                )}
                {status === 'ATTEMPTED' && (
                  <span className="absolute right-3 top-3 flex items-center gap-1 font-display text-[0.64rem] font-bold uppercase tracking-[0.14em] text-amber-300">
                    <Icon name="swords" className="h-3 w-3" />
                    Retry
                  </span>
                )}

                <p className="font-mono text-[0.66rem] font-bold text-slate-500">#{String(p.id).padStart(3, '0')}</p>
                <p className={`mt-0.5 text-[0.95rem] font-semibold leading-snug text-slate-100 ${status ? 'pr-20' : 'pr-2'}`}>{p.title}</p>
                <div className="mt-3">
                  <DifficultyBadge level={p.difficultyLevel} />
                </div>
              </button>
            )
          })}
        </div>

        <div className="flex items-center justify-between gap-3 text-sm">
          <button
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - limit))}
            className="btn-ghost h-10 rounded-lg px-4 font-semibold"
          >
            <Icon name="arrowLeft" className="h-4 w-4" /> Previous
          </button>
          <span className="font-mono text-xs font-bold tabular-nums text-slate-500">
            {total === 0 ? 0 : offset + 1}–{Math.min(offset + limit, total)} of {total}
          </span>
          <button
            disabled={offset + limit >= total}
            onClick={() => setOffset(offset + limit)}
            className="btn-ghost h-10 rounded-lg px-4 font-semibold"
          >
            Next <Icon name="arrowRight" className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

export default ProblemsPage
