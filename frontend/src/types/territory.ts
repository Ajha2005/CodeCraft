// Mirrors the TerritoryDto shape returned by the backend's
// GET /territories endpoint (see backend/src/territory/territory.service.ts):
// the zone list only. Who owns what comes from /territories/owners.
export interface TerritoryDto {
  id: string;
  name: string;
  svgPathId: string;
  tier: string;
}
export interface SubmissionResult {
  verdict: string;
  totalPassed: number;
  totalTests: number;
  pointsAwarded?: boolean;
  noPointsReason?: 'ALREADY_SOLVED' | 'DAILY_LIMIT' | null;
}
