import { useEffect, useState } from 'react'
import './App.css'

const API_BASE = 'http://localhost:3000'

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
}

interface ProblemListResponse {
  items: ProblemSummary[]
  total: number
  limit: number
  offset: number
}

function App() {
  const [problems, setProblems] = useState<ProblemSummary[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [limit] = useState(20)
  const [difficulty, setDifficulty] = useState('')
  const [selectedProblem, setSelectedProblem] = useState<ProblemDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

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

    fetch(`${API_BASE}/problems/${id}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed: ${res.status}`)
        return res.json()
      })
      .then((data: ProblemDetail) => setSelectedProblem(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }

  if (selectedProblem) {
    return (
      <div className="max-w-3xl mx-auto p-6 text-left">
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
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto p-6 text-left">
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

export default App