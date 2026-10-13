// Mirrors the TerritoryDto shape returned by the backend's
// GET /territories endpoint (see backend/src/territory/territory.service.ts)
export interface TerritoryDto {
  id: string;
  name: string;
  svgPathId: string;
  ownerColor: string;
  ownerId: string | null;
  tier: string;
}
export interface SubmissionResult {
  verdict: string;
  totalPassed: number;
  totalTests: number;
  pointsAwarded?: boolean;
  noPointsReason?: 'ALREADY_SOLVED' | 'DAILY_LIMIT' | null;
}