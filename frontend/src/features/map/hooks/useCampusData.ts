import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchGrid, fetchOwners, fetchTerritories, type GridResponse, type TerritoryCellDto } from '../../../lib/api';
import { getSocket } from '../../../lib/socket';
import type { TerritoryDto } from '../../../types/territory';
import { applyCellUpdate, buildCells, type CellUpdate } from '../data/buildCells';

interface Loaded {
  zones: TerritoryDto[];
  grid: GridResponse;
  cells: TerritoryCellDto[];
}

/**
 * Reads the grid and the owners, which are separate requests because the grid
 * is the same for everybody and cacheable, while ownership is per viewer. If
 * the browser's cached grid is from before a regrid (the owners answer names a
 * newer grid version) it is fetched again, bypassing the cache.
 */
async function loadAll(): Promise<Loaded> {
  const [zones, cachedGrid, owners] = await Promise.all([fetchTerritories(), fetchGrid(), fetchOwners()]);
  let grid = cachedGrid;
  if (grid.gridVersion !== owners.gridVersion) grid = await fetchGrid({ fresh: true });
  if (grid.gridVersion !== owners.gridVersion) throw new Error('The map is being updated. Try again in a moment.');
  return { zones, grid, cells: buildCells(zones, grid, owners) };
}

/** Everything the map needs: the zones, every cell with its owner, and live updates over the socket. */
export function useCampusData() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Always the latest data, written synchronously by the socket handlers so two updates in one tick both land.
  const live = useRef<Loaded | null>(null);

  const retry = useCallback(() => {
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadAll()
      .then((data) => {
        if (cancelled) return;
        live.current = data;
        setLoaded(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the map');
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  useEffect(() => {
    const socket = getSocket();
    let everConnected = socket.connected;
    let reloading = false;

    const reload = () => {
      if (reloading) return;
      reloading = true;
      loadAll()
        .then((data) => {
          live.current = data;
          setLoaded(data);
        })
        .catch(() => {
          // keep showing what we have; the next event or reconnect tries again
        })
        .finally(() => {
          reloading = false;
        });
    };

    const onCellUpdated = (update: CellUpdate) => {
      const current = live.current;
      if (!current) return;
      const cells = applyCellUpdate(current.cells, update);
      if (!cells) {
        reload(); // a cell we have never heard of: the grid has changed under us
        return;
      }
      live.current = { ...current, cells };
      setLoaded(live.current);
    };

    // After a dropped connection we may have missed updates, so ask for the owners again.
    const onConnect = () => {
      if (!everConnected) {
        everConnected = true;
        return;
      }
      reload();
    };

    socket.on('cell:updated', onCellUpdated);
    socket.on('connect', onConnect);
    return () => {
      socket.off('cell:updated', onCellUpdated);
      socket.off('connect', onConnect);
    };
  }, []);

  const territories = useMemo(() => {
    const bySlug: Record<string, TerritoryDto> = {};
    for (const zone of loaded?.zones ?? []) bySlug[zone.svgPathId] = zone;
    return bySlug;
  }, [loaded?.zones]);

  const cells = loaded?.cells;
  const cellsByTerritory = useMemo(() => {
    const grouped: Record<string, TerritoryCellDto[]> = {};
    for (const cell of cells ?? []) (grouped[cell.territoryId] ??= []).push(cell);
    return grouped;
  }, [cells]);

  return { territories, cellsByTerritory, loading: !loaded && !error, error, retry };
}
