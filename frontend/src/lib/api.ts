import type { TerritoryDto } from '../types/territory';
import { ApiError, request } from './http';

// The zone list is public (the login page counts the zones) and holds no player data.
export function fetchTerritories(): Promise<TerritoryDto[]> {
  return request<TerritoryDto[]>('/territories', { auth: false });
}

/**
 * One cell of the campus map, as the map draws it. The server sends the cell
 * layout and the ownership separately (see fetchGrid / fetchOwners) and the
 * map's data hook joins them into this shape.
 */
export interface TerritoryCellDto {
  id: string;
  territoryId: string;
  row: number;
  col: number;
  /**
   * An opaque key that is the same for every cell one player holds (it is their
   * username). It is NOT a database id: the server never sends user ids to other
   * players. Null for an unclaimed cell. Use `isMe` to ask whether a cell is yours.
   */
  ownerId: string | null;
  ownerUsername: string | null;
  ownerColor: string;
  /** Decided by the server for the signed-in player; always false for a demo guest. */
  isMe: boolean;
}

/** Which cells exist: static between regrids, so the browser may keep it for a few minutes. */
export interface GridResponse {
  gridVersion: number;
  /** Zone slugs (the SVG path ids); a cell's second entry indexes into this. */
  zones: string[];
  /** [cell id, zone index, row, col] */
  cells: [string, number, number, number][];
}

/** Who holds what, for the caller. */
export interface OwnersResponse {
  gridVersion: number;
  owners: { username: string; color: string; isMe: boolean }[];
  /** [index into the grid's cells, index into owners] */
  held: [number, number][];
}

export function fetchGrid(options: { fresh?: boolean } = {}): Promise<GridResponse> {
  return request<GridResponse>('/territories/grid', { cache: options.fresh ? 'reload' : undefined });
}

export function fetchOwners(): Promise<OwnersResponse> {
  return request<OwnersResponse>('/territories/owners');
}

/** A row of a leaderboard. The server sends a handle and a score, never an id or a real name. */
export interface LeaderboardEntry {
  username: string;
  score: number;
  /** True for the signed-in player's own row (decided by the server). */
  isMe: boolean;
  /** The player's map color. */
  color: string;
}

export function fetchCollegeLeaderboard(limit = 50): Promise<LeaderboardEntry[]> {
  return request<LeaderboardEntry[]>(`/leaderboard/college?limit=${limit}`);
}

export function fetchTerritoryLeaderboard(territoryId: string, limit = 20): Promise<LeaderboardEntry[]> {
  return request<LeaderboardEntry[]>(`/leaderboard/territory/${encodeURIComponent(territoryId)}?limit=${limit}`);
}

export interface StreakInfo {
  current: number;
  longest: number;
}

/** The signed-in player's streak. */
export function fetchStreak(): Promise<StreakInfo> {
  return request<StreakInfo>('/scoring/me/streak');
}

/** What anyone signed in (a demo guest included) may see about a player (GET /users/:username). */
export interface PublicProfile {
  username: string;
  totalScore: number;
  cellsHeld: number;
  territoriesHeld: number;
  problemsSolved: number;
  /** ISO date. */
  joinedAt: string;
  /** The player's map color. */
  color: string;
  /** True when this is the signed-in player's own profile (decided by the server). */
  isMe: boolean;
}

/** A player's public profile, or null when nobody has that username. */
export async function fetchPublicProfile(username: string): Promise<PublicProfile | null> {
  try {
    return await request<PublicProfile>(`/users/${encodeURIComponent(username)}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}
