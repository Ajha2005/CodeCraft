import { useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchCollegeLeaderboard,
  fetchTerritoryLeaderboard,
  type LeaderboardEntry,
} from '../../../lib/api';
import { getSocket } from '../../../lib/socket';

/** How a player moved the last time the board changed. */
export interface RankMove {
  /** Places gained (positive) or lost (negative). 0 when only the score moved. */
  delta: number;
  /** Points gained by this player since the board last changed. */
  scoreDelta: number;
  /** When this was noticed (ms), so the same move is animated once. */
  at: number;
}

export type RankedEntry = LeaderboardEntry & { rank: number; move: RankMove | null };

/** How long a ▲/▼ chip stays on a row. */
export const MOVE_VISIBLE_MS = 8000;
/** Burst of score changes (several solves finishing together) are fetched as one. */
const REFETCH_DEBOUNCE_MS = 300;

/**
 * `live` keeps the board in sync with `leaderboard:updated` socket events. Pass
 * false when you only need a snapshot: every subscribed client refetches on
 * every score change anywhere, so idle subscribers are pure server load.
 *
 * Every entry also carries its `rank` and, for a few seconds after the board
 * changes, a `move` saying how far it climbed or fell, so the UI can animate it.
 */
export function useCollegeLeaderboard(limit = 50, live = true) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [moves, setMoves] = useState<Record<string, RankMove>>({});
  const [loading, setLoading] = useState(true);
  // What the board looked like last time, to see who moved. A ref, so it
  // survives the effect restarting when `live` flips.
  const previous = useRef<Map<string, { rank: number; score: number }> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let debounce: number | undefined;

    const apply = (data: LeaderboardEntry[]) => {
      const before = previous.current;
      const after = new Map(data.map((e, i) => [e.userId, { rank: i + 1, score: e.score }]));
      previous.current = after;
      setEntries(data);
      if (!before) return; // the first look has nothing to compare with

      const now = Date.now();
      const fresh: Record<string, RankMove> = {};
      for (const [userId, cur] of after) {
        const old = before.get(userId);
        // someone new on the board enters from "below the board": treat as a climb to their rank
        const delta = old ? old.rank - cur.rank : before.size >= limit ? limit + 1 - cur.rank : 0;
        const scoreDelta = old ? cur.score - old.score : cur.score;
        if (delta !== 0 || Math.abs(scoreDelta) > 1e-9) fresh[userId] = { delta, scoreDelta, at: now };
      }
      if (Object.keys(fresh).length > 0) setMoves((prev) => ({ ...pruneMoves(prev, now), ...fresh }));
    };

    const load = () =>
      fetchCollegeLeaderboard(limit)
        .then((data) => {
          if (!cancelled) apply(data);
        })
        .catch(() => {
          // silent failure: keep showing stale data rather than clearing the
          // UI on a transient network hiccup
        });

    load().finally(() => {
      if (!cancelled) setLoading(false);
    });

    if (!live) {
      return () => {
        cancelled = true;
      };
    }

    // The payload only says *a* score changed, not the new ranking - the
    // simplest correct move is to refetch rather than patch client-side.
    const onUpdate = () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => void load(), REFETCH_DEBOUNCE_MS);
    };
    const socket = getSocket();
    socket.on('leaderboard:updated', onUpdate);
    return () => {
      cancelled = true;
      window.clearTimeout(debounce);
      socket.off('leaderboard:updated', onUpdate);
    };
  }, [limit, live]);

  // Let the chips go once their time is up.
  useEffect(() => {
    const times = Object.values(moves).map((m) => m.at);
    if (times.length === 0) return;
    const wait = Math.max(0, Math.min(...times) + MOVE_VISIBLE_MS - Date.now()) + 50;
    const id = window.setTimeout(() => setMoves((prev) => pruneMoves(prev, Date.now())), wait);
    return () => window.clearTimeout(id);
  }, [moves]);

  const ranked = useMemo<RankedEntry[]>(() => entries.map((e, i) => ({ ...e, rank: i + 1, move: moves[e.userId] ?? null })), [entries, moves]);
  return { entries: ranked, loading };
}

function pruneMoves(moves: Record<string, RankMove>, now: number): Record<string, RankMove> {
  const kept: Record<string, RankMove> = {};
  for (const [id, m] of Object.entries(moves)) if (now - m.at < MOVE_VISIBLE_MS) kept[id] = m;
  return kept;
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
