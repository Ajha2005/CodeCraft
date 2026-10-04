// What a submission looks like in a response. No `code`, no `userId`: the owner
// already has their code, and nothing else about a submission is needed by a client.
export interface SubmissionDto {
  id: string;
  problemId: number;
  language: string;
  verdict: string;
  totalPassed: number;
  totalTests: number;
  pointsAwarded: boolean;
  noPointsReason: string | null;
  createdAt: Date;
}

export const submissionSelect = {
  id: true,
  problemId: true,
  language: true,
  verdict: true,
  totalPassed: true,
  totalTests: true,
  pointsAwarded: true,
  noPointsReason: true,
  createdAt: true,
} as const;
