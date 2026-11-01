import { useEffect, useState } from 'react';

/** The current time, refreshed every `everyMs` (a minute by default) so "late in the day" states flip without a reload. */
export function useNow(everyMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), everyMs);
    return () => window.clearInterval(id);
  }, [everyMs]);
  return now;
}
