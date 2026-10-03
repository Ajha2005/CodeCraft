import { useEffect, useState } from 'react';
import {
  fetchCollegeLeaderboard,
  fetchTerritoryLeaderboard,
  type LeaderboardEntry,
} from '../../../lib/api';
import { getSocket } from '../../../lib/socket';

export function useCollegeLeaderboard(limit = 50) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = () =>
      fetchCollegeLeaderboard(limit)
        .then((data) => {
          if (!cancelled) setEntries(data);
        })
        .catch(() => {
          // silent failure: keep showing stale data rather than clearing the
          // UI on a transient network hiccup
        });

    load().finally(() => {
      if (!cancelled) setLoading(false);
    });

    // The payload only says *a* score changed, not the new ranking - the
    // simplest correct move is to refetch rather than patch client-side.
    const socket = getSocket();
    socket.on('leaderboard:updated', load);
    return () => {
      cancelled = true;
      socket.off('leaderboard:updated', load);
    };
  }, [limit]);

  return { entries, loading };
}

export function useTerritoryLeaderboard(territoryId: string | null, limit = 20) {
  // Entries are stored together with the territory they belong to, so a stale
  // response for the previously selected territory can never be shown for the
  // current one, and "loading" is simply "we have nothing for this id yet".
  const [data, setData] = useState<{ id: string; entries: LeaderboardEntry[] } | null>(null);

  useEffect(() => {
    if (!territoryId) return;
    let cancelled = false;

    const load = () => {
      fetchTerritoryLeaderboard(territoryId, limit)
        .then((entries) => {
          if (!cancelled) setData({ id: territoryId, entries });
        })
        .catch(() => {
          if (!cancelled) setData((prev) => (prev?.id === territoryId ? prev : { id: territoryId, entries: [] }));
        });
    };

    load();
    // A territory-specific leaderboard should also refresh on any
    // college-wide score change, since both views read the same scores.
    const socket = getSocket();
    socket.on('leaderboard:updated', load);
    return () => {
      cancelled = true;
      socket.off('leaderboard:updated', load);
    };
  }, [territoryId, limit]);

  const entries = territoryId && data?.id === territoryId ? data.entries : [];
  const loading = !!territoryId && data?.id !== territoryId;
  return { entries, loading };
}
