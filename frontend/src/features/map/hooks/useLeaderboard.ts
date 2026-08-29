import { useEffect, useState, useCallback } from 'react';
import {
  fetchCollegeLeaderboard,
  fetchTerritoryLeaderboard,
  type LeaderboardEntry,
} from '../../../lib/api';
import { getSocket } from '../../../lib/socket';

export function useCollegeLeaderboard(limit = 50) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(() => {
    fetchCollegeLeaderboard(limit)
      .then(setEntries)
      .catch(() => {
        // silent failure on background refresh — keep showing stale data
        // rather than clearing the UI on a transient network hiccup
      });
  }, [limit]);

  useEffect(() => {
    setLoading(true);
    fetchCollegeLeaderboard(limit)
      .then(setEntries)
      .finally(() => setLoading(false));

    const socket = getSocket();
    const handleLeaderboardUpdate = () => {
      // Payload only tells us *a* score changed, not the full new
      // ranking — simplest correct approach is just refetch the
      // whole leaderboard rather than trying to patch it client-side.
      refetch();
    };

    socket.on('leaderboard:updated', handleLeaderboardUpdate);
    return () => {
      socket.off('leaderboard:updated', handleLeaderboardUpdate);
    };
  }, [limit, refetch]);

  return { entries, loading };
}

export function useTerritoryLeaderboard(territoryId: string | null, limit = 20) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const refetch = useCallback(() => {
    if (!territoryId) return;
    fetchTerritoryLeaderboard(territoryId, limit).then(setEntries).catch(() => {});
  }, [territoryId, limit]);

  useEffect(() => {
    if (!territoryId) {
      setEntries([]);
      return;
    }
    setLoading(true);
    fetchTerritoryLeaderboard(territoryId, limit)
      .then(setEntries)
      .finally(() => setLoading(false));

    const socket = getSocket();
    // A territory-specific leaderboard should also refresh on any
    // college-wide score change, since scores feed both views from
    // the same underlying PerformanceScore data.
    socket.on('leaderboard:updated', refetch);
    return () => {
      socket.off('leaderboard:updated', refetch);
    };
  }, [territoryId, limit, refetch]);

  return { entries, loading };
}