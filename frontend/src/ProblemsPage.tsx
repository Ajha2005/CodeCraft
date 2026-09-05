import { useEffect, useState } from 'react'
import Editor from '@monaco-editor/react'
import confetti from 'canvas-confetti'
import { useAuth } from './auth/AuthContext'

const API_BASE = 'http://localhost:3000'

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

function ProblemsPage() {
  const { user, token, logout } = useAuth()

  const [problems, setProblems] = useState<ProblemSummary[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [limit] = useState(20)
  const [difficulty, setDifficulty] = useState('')
  const [selectedProblem, setSelectedProblem] = useState<ProblemDetail | null>(null)
  const [language, setLanguage] = useState('python')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [code, setCode] = useState('def solve(*args, **kwargs):\n    pass\n')
  const [submitting, setSubmitting] = useState(false)
  const [submissionResult, setSubmissionResult] = useState<SubmissionResult | null>(null)
  const [scoreResult, setScoreResult] = useState<ScoreResult | null>(null)
  const [submitError, setSubmitError] = useState('')

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

  function pollSubmission(id: string) {
    const interval = setInterval(() => {
      fetch(`${API_BASE}/submissions/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((res) => res.json())
        .then((data: SubmissionResult) => {
          setSubmissionResult(data)
          if (data.verdict !== 'PENDING') {
            clearInterval(interval)
            if (data.verdict === 'AC') {
              fireCelebration(data.id)
            }
          }
        })
        .catch(() => clearInterval(interval))
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
        pollSubmission(data.id)
      })
      .catch((err) => setSubmitError(err.message))
      .finally(() => setSubmitting(false))
  }

  function verdictColor(verdict: string) {
    if (verdict === 'AC') return 'text-green-600'
    if (verdict === 'PENDING') return 'text-yellow-600'
    return 'text-red-600'
  }

  const header = (
    <div className="flex justify-between items-center mb-4 text-sm">
      <span className="opacity-70">{user?.email}</span>
      <button onClick={logout} className="underline">
        Logout
      </button>
    </div>
  )

  if (selectedProblem) {
    return (
      <div className="max-w-5xl mx-auto p-6 text-left">
        {header}
        <button
          onClick={() => setSelectedProblem(null)}
          className="mb-4 text-sm underline"
        >
          ← Back to list
        </button>
        <h1 className="text-2xl font-semibold mb-1">{selectedProblem.title}</h1>
        <p className="text-sm mb-4 opacity-70">{selectedProblem.difficultyLevel}</p>
        <p className="mb-6 whitespace-pre-wrap">{selectedProblem.description}</p>

        <h2 className="text-lg font-medium mb-2">Examples</h2>
        {selectedProblem.examples.map((ex, i) => (
          <pre
            key={i}
            className="bg-black/5 rounded p-3 mb-3 text-sm overflow-x-auto"
          >
{`Input: ${JSON.stringify(ex.input)}\nOutput: ${JSON.stringify(ex.output)}`}
          </pre>
        ))}

        <h2 className="text-lg font-medium mb-2">Constraints</h2>
        <ul className="list-disc pl-5 mb-6">
          {selectedProblem.constraints.map((c, i) => (
            <li key={i} className="text-sm">{c}</li>
          ))}
        </ul>

        <h2 className="text-lg font-medium mb-2">Your Solution</h2>

        <div className="flex items-center gap-2 mb-2">
          <label className="text-sm opacity-70">Language:</label>
          <select
            value={language}
            onChange={(e) => {
              const newLang = e.target.value
              setLanguage(newLang)
              if (selectedProblem) {
                setCode(selectedProblem.boilerplate[newLang] || '')
              }
            }}
            className="border rounded px-2 py-1 text-sm"
          >
            <option value="python">Python</option>
            <option value="c++">C++</option>
          </select>
        </div>
        <div className="border rounded overflow-hidden mb-3">
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
          className="px-4 py-2 rounded bg-black text-white text-sm disabled:opacity-50 mb-4"
        >
          {submitting ? 'Submitting…' : 'Submit'}
        </button>

        {submitError && <p className="text-red-500 mb-4">{submitError}</p>}

        {submissionResult && (
          <div>
            <p className={`font-semibold ${verdictColor(submissionResult.verdict)}`}>
              Verdict: {submissionResult.verdict}
            </p>

            <p>
              Passed: {submissionResult.totalPassed} / {submissionResult.totalTests}
            </p>

            {submissionResult.verdict === 'AC' &&
              submissionResult.pointsAwarded === false && (
                <p className="text-amber-500 text-sm mt-1">
                  {submissionResult.noPointsReason === 'ALREADY_SOLVED'
                    ? "You've already earned points for this problem — no additional territory or score awarded."
                    : submissionResult.noPointsReason === 'DAILY_LIMIT'
                    ? "Daily submission limit reached — this solve won't count toward score today."
                    : "No points awarded for this submission."}
                </p>
              )}
          </div>
        )}
        {submissionResult?.verdict === 'AC' && scoreResult && (
          <div className="mt-4 border-2 border-green-400 rounded-lg p-4 bg-green-50">
            <p className="text-lg font-bold text-green-700">🎉 Accepted! +{scoreResult.totalScore.toFixed(1)} pts</p>
            <div className="text-sm opacity-80 mt-1 space-y-0.5">
              <p>Difficulty weight: {scoreResult.difficultyWeight}</p>
              <p>Attempts penalty: -{scoreResult.attemptsPenalty.toFixed(1)}</p>
              <p>Time efficiency bonus: +{scoreResult.timeEfficiency.toFixed(1)}</p>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto p-6 text-left">
      {header}
      <h1 className="text-2xl font-semibold mb-4">Problems</h1>

      <div className="flex gap-2 mb-4">
        {['', 'Easy', 'Medium', 'Hard'].map((d) => (
          <button
            key={d || 'all'}
            onClick={() => {
              setDifficulty(d)
              setOffset(0)
            }}
            className={`px-3 py-1 rounded text-sm border ${
              difficulty === d ? 'bg-black text-white' : ''
            }`}
          >
            {d || 'All'}
          </button>
        ))}
      </div>

      {error && <p className="text-red-500 mb-4">{error}</p>}
      {loading && <p className="mb-4 opacity-60">Loading…</p>}

      <ul className="divide-y divide-black/10 mb-4">
        {problems.map((p) => (
          <li key={p.id}>
            <button
              onClick={() => openProblem(p.id)}
              className="w-full text-left py-2 flex justify-between hover:opacity-70"
            >
              <span>{p.title}</span>
              <span className="text-sm opacity-60">{p.difficultyLevel}</span>
            </button>
          </li>
        ))}
      </ul>

      <div className="flex justify-between items-center text-sm">
        <button
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - limit))}
          className="underline disabled:opacity-30"
        >
          Previous
        </button>
        <span>
          {offset + 1}–{Math.min(offset + limit, total)} of {total}
        </span>
        <button
          disabled={offset + limit >= total}
          onClick={() => setOffset(offset + limit)}
          className="underline disabled:opacity-30"
        >
          Next
        </button>
      </div>
    </div>
  )
}

export default ProblemsPage