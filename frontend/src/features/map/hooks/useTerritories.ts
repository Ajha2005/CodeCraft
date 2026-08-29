// hooks/useTerritories.ts
import { useEffect, useState } from 'react';
import { fetchTerritories } from '../../../lib/api';
import { getSocket } from '../../../lib/socket';
import type { TerritoryDto } from '../../../types/territory';

export function useTerritories() {
  const [territories, setTerritories] = useState<Record<string, TerritoryDto>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTerritories().then((data) => {
      const byId: Record<string, TerritoryDto> = {};
      for (const t of data) byId[t.svgPathId] = t;
      setTerritories(byId);
      setLoading(false);
    });

    const socket = getSocket();

    const handleUpdate = (payload: {
      territoryId: string;
      ownerId: string | null;
      ownerColor: string;
    }) => {
      console.log('[territory:updated] received', payload);

      setTerritories((prev) => {
        const entry = Object.values(prev).find(
          (t) => t.id === payload.territoryId
        );

        if (!entry) {
          console.warn(
            '[territory:updated] no matching territory for id',
            payload.territoryId
          );
          return prev;
        }

        console.log(
          '[territory:updated] patching',
          entry.svgPathId,
          '→',
          payload.ownerColor
        );

        return {
          ...prev,
          [entry.svgPathId]: {
            ...entry,
            ownerId: payload.ownerId,
            ownerColor: payload.ownerColor,
          },
        };
      });
    };

    socket.on('territory:updated', handleUpdate);

    return () => {
      socket.off('territory:updated', handleUpdate);
    };
  }, []);

  return { territories, loading };
}