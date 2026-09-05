import type { TerritoryDto } from '../types/territory';

// Adjust to match wherever your backend actually runs
const API_BASE_URL = 'http://localhost:3000';

export async function fetchTerritories(): Promise<TerritoryDto[]> {
  const res = await fetch(`${API_BASE_URL}/territories`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch territories: ${res.status}`);
  return res.json();
}

export interface TerritoryCellDto {
  id: string;
  territoryId: string;
  row: number;
  col: number;
  ownerId: string | null;
  ownerColor: string;
}

export async function fetchTerritoryCells(): Promise<TerritoryCellDto[]> {
  const res = await fetch(`${API_BASE_URL}/territories/cells`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch territory cells: ${res.status}`);
  return res.json();
}

export interface LeaderboardEntry {
  userId: string;
  name: string;
  score: number;
}

export async function fetchCollegeLeaderboard(limit = 50): Promise<LeaderboardEntry[]> {
  const res = await fetch(`${API_BASE_URL}/leaderboard/college?limit=${limit}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch college leaderboard: ${res.status}`);
  }
  return res.json();
}

export async function fetchTerritoryLeaderboard(
  territoryId: string,
  limit = 20,
): Promise<LeaderboardEntry[]> {
  const res = await fetch(`${API_BASE_URL}/leaderboard/territory/${territoryId}?limit=${limit}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch territory leaderboard: ${res.status}`);
  }
  return res.json();
}

