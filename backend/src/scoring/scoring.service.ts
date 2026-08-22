import { Injectable } from '@nestjs/common';

const DIFFICULTY_WEIGHT: Record<string, number> = {
  Easy: 10,
  Medium: 25,
  Hard: 50,
};

@Injectable()
export class ScoringService {
  computeScore(params: {
    difficultyLevel: string;
    attempts: number;
    timePercentile?: number; // 0 = fastest, 1 = slowest; optional for v1
  }) {
    const difficultyWeight = DIFFICULTY_WEIGHT[params.difficultyLevel] ?? 10;
    const correctness = 1; // only called on AC

    const attemptsPenalty =
      Math.min(params.attempts - 1, 5) * (0.05 * difficultyWeight);

    const percentile = params.timePercentile ?? 0.5; // default: median
    const timeEfficiency = (1 - percentile) * 0.2 * difficultyWeight;

    const totalScore =
      difficultyWeight * correctness - attemptsPenalty + timeEfficiency;

    return {
      difficultyWeight,
      correctness,
      attemptsPenalty,
      timeEfficiency,
      totalScore,
    };
  }

  getTerritoryTier(score: number): string {
    if (score < 15) return 'OUTPOST';
    if (score < 35) return 'SETTLEMENT';
    if (score < 55) return 'STRONGHOLD';
    return 'CITADEL';
  }
}
