import { Injectable, Inject } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from './redis.module';

/**
 * Leaderboards are a textbook use case for Redis Sorted Sets (ZSET):
 * - ZADD to update a score in O(log N)
 * - ZREVRANGE to get top-N ranked in O(log N + M)
 * - No need to re-run a heavy Postgres aggregation on every read
 */
@Injectable()
export class LeaderboardRedisService {
  private collegeKey = 'leaderboard:college';
  private territoryKey = (territoryId: string) => `leaderboard:territory:${territoryId}`;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async updateCollegeScore(userId: string, score: number): Promise<void> {
    await this.redis.zadd(this.collegeKey, score, userId);
  }

  async updateTerritoryScore(territoryId: string, userId: string, score: number): Promise<void> {
    await this.redis.zadd(this.territoryKey(territoryId), score, userId);
  }

  async getCollegeTop(limit = 50): Promise<{ userId: string; score: number }[]> {
    const raw = await this.redis.zrevrange(this.collegeKey, 0, limit - 1, 'WITHSCORES');
    return this.parseZrangeWithScores(raw);
  }

  async getTerritoryTop(territoryId: string, limit = 20): Promise<{ userId: string; score: number }[]> {
    const raw = await this.redis.zrevrange(this.territoryKey(territoryId), 0, limit - 1, 'WITHSCORES');
    return this.parseZrangeWithScores(raw);
  }

  async getCollegeRank(userId: string): Promise<number | null> {
    const rank = await this.redis.zrevrank(this.collegeKey, userId);
    return rank === null ? null : rank + 1;
  }

  async getCollegeScore(userId: string): Promise<number | null> {
    const score = await this.redis.zscore(this.collegeKey, userId);
    return score === null ? null : Number(score);
  }

  /** 0-indexed rank lookup — rank 0 is first place. */
  async getCollegeEntryAtRank(rank: number): Promise<{ userId: string; score: number } | null> {
    if (rank < 0) return null;
    const raw = await this.redis.zrevrange(this.collegeKey, rank, rank, 'WITHSCORES');
    if (raw.length === 0) return null;
    return { userId: raw[0], score: Number(raw[1]) };
  }

  private parseZrangeWithScores(raw: string[]): { userId: string; score: number }[] {
    const result: { userId: string; score: number }[] = [];
    for (let i = 0; i < raw.length; i += 2) {
      result.push({ userId: raw[i], score: Number(raw[i + 1]) });
    }
    return result;
  }
}