// hooks/useTerritories.ts
import { useCallback, useEffect, useState } from 'react';
import { fetchTerritories } from '../../../lib/api';
import { getSocket } from '../../../lib/socket';
import type { TerritoryDto } from '../../../types/territory';

export function useTerritories() {
  const [territories, setTerritories] = useState<Record<string, TerritoryDto>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setLoading(true);
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetchTerritories()
      .then((data) => {
        if (cancelled) return;
        const byId: Record<string, TerritoryDto> = {};
        for (const t of data) byId[t.svgPathId] = t;
        setTerritories(byId);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not load territories');
        setLoading(false);
      });

    const socket = getSocket();

    const handleUpdate = (payload: { territoryId: string; ownerId: string | null; ownerColor: string }) => {
      setTerritories((prev) => {
        const entry = Object.values(prev).find((t) => t.id === payload.territoryId);
        if (!entry) return prev;
        return {
          ...prev,
          [entry.svgPathId]: { ...entry, ownerId: payload.ownerId, ownerColor: payload.ownerColor },
        };
      });
    };

    socket.on('territory:updated', handleUpdate);

    return () => {
      cancelled = true;
      socket.off('territory:updated', handleUpdate);
    };
  }, [attempt]);

  return { territories, loading, error, retry };
}
