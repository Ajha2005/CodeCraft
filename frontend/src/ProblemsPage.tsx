import { useCallback, useLayoutEffect, useRef } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { ToastStack } from './components/ToastStack'
import { useToasts } from './lib/useToasts'
import { ProblemWorkspace } from './features/problems/ProblemWorkspace'
import { QuestBoard } from './features/problems/QuestBoard'
import { useProblemCatalog } from './features/problems/useProblemCatalog'

interface NavState {
  /** Set when the problem was opened from the board, so "back" can really go back. */
  fromBoard?: boolean
}

/**
 * The problems route. The open problem lives in the URL (`/?problem=12`), so
 * the browser's Back button, refresh and shared links all behave. The quest
 * board stays mounted underneath, which keeps its search and filters.
 */
export default function ProblemsPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const catalog = useProblemCatalog()
  const { toasts, push, dismiss } = useToasts()
  const solveStreak = useRef(0)
  const boardScroll = useRef(0)

  const raw = params.get('problem')
  const problemId = raw && /^\d+$/.test(raw) ? Number(raw) : null
  const fromBoard = (location.state as NavState | null)?.fromBoard === true

  // Opening a problem starts at its top; coming back returns to where you were on the board.
  useLayoutEffect(() => {
    window.scrollTo(0, problemId === null ? boardScroll.current : 0)
  }, [problemId])

  const openFromBoard = useCallback(
    (id: number) => {
      boardScroll.current = window.scrollY
      setParams({ problem: String(id) }, { state: { fromBoard: true } as NavState })
    },
    [setParams],
  )

  // "Next quest" swaps the entry instead of stacking one, so Back still returns to the board.
  const openNext = useCallback(
    (id: number) => {
      setParams({ problem: String(id) }, { replace: true, state: location.state })
    },
    [setParams, location.state],
  )

  const closeProblem = useCallback(() => {
    if (fromBoard) navigate(-1)
    else setParams({}, { replace: true })
  }, [fromBoard, navigate, setParams])

  const recordVerdict = useCallback((accepted: boolean) => {
    solveStreak.current = accepted ? solveStreak.current + 1 : 0
    return solveStreak.current
  }, [])

  return (
    <>
      <ToastStack toasts={toasts} dismiss={dismiss} placement="top-right" />
      <div hidden={problemId !== null} className="flex flex-1 flex-col">
        <QuestBoard catalog={catalog} active={problemId === null} onOpen={openFromBoard} />
      </div>
      {problemId !== null && (
        <ProblemWorkspace key={problemId} id={problemId} catalog={catalog} push={push} recordVerdict={recordVerdict} onBack={closeProblem} onNext={openNext} />
      )}
    </>
  )
}
