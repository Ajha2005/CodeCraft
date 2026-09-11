// Mirrors the shapes returned by backend/src/contest/contest.service.ts

export type ContestStatus = 'PENDING' | 'ACTIVE' | 'COMPLETED' | 'DECLINED' | 'CANCELLED' | 'EXPIRED';

export interface ContestCellSummary {
  id: string;
  row: number;
  col: number;
  territoryId: string;
  territoryName: string;
  tier: string;
}

export interface ContestProblemSummary {
  id: number;
  title: string;
  difficultyLevel: string;
}

export interface ContestUserSummary {
  id: string;
  name: string;
}

export interface ContestSummary {
  id: string;
  status: ContestStatus;
  cell: ContestCellSummary;
  problem: ContestProblemSummary;
  challenger: ContestUserSummary;
  defender: ContestUserSummary;
  durationSeconds: number;
  winnerId: string | null;
  endReason: string | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

export interface ContestParticipantDetail {
  userId: string;
  verdict: string | null;
  totalPassed: number;
  totalTests: number;
  solvedAt: string | null;
  connected: boolean;
}

export interface ContestProblemDetail {
  id: number;
  title: string;
  description: string;
  difficultyLevel: string;
  examples: { input: unknown; output: unknown }[];
  constraints: string[];
  testCases: { input: unknown; expected_output: unknown }[];
  boilerplate: Record<string, string>;
}

export interface ContestDetail {
  id: string;
  status: ContestStatus;
  cell: ContestCellSummary;
  problem: ContestProblemDetail;
  challenger: ContestUserSummary;
  defender: ContestUserSummary;
  durationSeconds: number;
  startedAt: string | null;
  endedAt: string | null;
  winnerId: string | null;
  endReason: string | null;
  participants: ContestParticipantDetail[];
}
