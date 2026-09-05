import { useEffect, useState, useMemo } from 'react';
import { fetchTerritoryCells } from '../../../lib/api';
import { getSocket } from '../../../lib/socket';
import type { TerritoryCellDto } from '../../../lib/api';

export function useTerritoryCells() {
  const [cells, setCells] = useState<TerritoryCellDto[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTerritoryCells().then((data) => {
      setCells(data);
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
        prev.map((c) =>
          c.id === payload.cellId
            ? { ...c, ownerId: payload.ownerId, ownerColor: payload.ownerColor }
            : c,
        ),
      );
    };

    socket.on('cell:updated', handleUpdate);
    return () => {
      socket.off('cell:updated', handleUpdate);
    };
  }, []);

  const cellsByTerritory = useMemo(() => {
    const grouped: Record<string, TerritoryCellDto[]> = {};
    for (const cell of cells) {
      (grouped[cell.territoryId] ??= []).push(cell);
    }
    return grouped;
  }, [cells]);

  return { cells, cellsByTerritory, loading };
}