import { useEffect, useState } from 'react';
import { listIncomingChallenges } from '../features/contest/api';

const POLL_MS = 60_000;

/**
 * How many duel challenges are waiting on this player. Polled gently (once a
 * minute, only while the tab is visible) so the nav badge stays honest
 * without adding meaningful load.
 */
export function useIncomingChallenges(enabled: boolean): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const load = () => {
      if (document.hidden) return;
      listIncomingChallenges()
        .then((list) => {
          if (!cancelled) setCount(list.length);
        })
        .catch(() => {
          // a badge is a nicety; stay quiet when the request fails
        });
    };

    const first = setTimeout(load, 400);
    const interval = setInterval(load, POLL_MS);
    document.addEventListener('visibilitychange', load);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(interval);
      document.removeEventListener('visibilitychange', load);
    };
  }, [enabled]);

  return count;
}
