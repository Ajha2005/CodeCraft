import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { fetchAllProblems, fetchStatuses, type ProblemStatus, type ProblemSummary } from './api';

/**
 * The whole problem list plus the player's status on each problem. The list is
 * small (id, title, difficulty), so it is read once and searched/filtered in
 * the browser instead of paging through the API.
 */
export function useProblemCatalog() {
  const { user, token } = useAuth();
  const userId = user?.userId ?? null;
  const [problems, setProblems] = useState<ProblemSummary[]>([]);
  const [status, setStatus] = useState<Record<number, ProblemStatus>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let ignore = false;
    fetchAllProblems()
      .then((list) => {
        if (!ignore) setProblems(list);
      })
      .catch((err: unknown) => {
        if (!ignore) setError(err instanceof Error ? err.message : 'Could not load problems');
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [attempt]);

  useEffect(() => {
    if (!userId) return;
    let ignore = false;
    fetchStatuses(userId, token)
      .then((s) => {
        if (!ignore) setStatus(s);
      })
      .catch(() => {});
    return () => {
      ignore = true;
    };
  }, [userId, token]);

  const retry = useCallback(() => {
    setLoading(true);
    setError('');
    setAttempt((n) => n + 1);
  }, []);

  /** Record a verdict. A cleared problem never goes back to "attempted". */
  const markStatus = useCallback((problemId: number, next: ProblemStatus) => {
    setStatus((prev) => (prev[problemId] === 'AC' || prev[problemId] === next ? prev : { ...prev, [problemId]: next }));
  }, []);

  return { problems, status, loading, error, retry, markStatus };
}

export type ProblemCatalog = ReturnType<typeof useProblemCatalog>;
