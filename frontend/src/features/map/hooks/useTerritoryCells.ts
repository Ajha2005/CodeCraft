import { useCallback, useEffect, useState, useMemo } from 'react';
import { fetchTerritoryCells } from '../../../lib/api';
import { getSocket } from '../../../lib/socket';
import type { TerritoryCellDto } from '../../../lib/api';

export function useTerritoryCells() {
  const [cells, setCells] = useState<TerritoryCellDto[]>([]);
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

    fetchTerritoryCells()
      .then((data) => {
        if (cancelled) return;
        setCells(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not load the territory grid');
        setLoading(false);
      });

    const socket = getSocket();
    const handleUpdate = (payload: {
      territoryId: string;
      cellId: string;
      row: number;
      col: number;
      ownerId: string | null;
      ownerColor: string;
    }) => {
      setCells((prev) =>
        prev.map((c) => (c.id === payload.cellId ? { ...c, ownerId: payload.ownerId, ownerColor: payload.ownerColor } : c)),
      );
    };

    socket.on('cell:updated', handleUpdate);
    return () => {
      cancelled = true;
      socket.off('cell:updated', handleUpdate);
    };
  }, [attempt]);

  const cellsByTerritory = useMemo(() => {
    const grouped: Record<string, TerritoryCellDto[]> = {};
    for (const cell of cells) {
      (grouped[cell.territoryId] ??= []).push(cell);
    }
    return grouped;
  }, [cells]);

  return { cells, cellsByTerritory, loading, error, retry };
}
