import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../common/redis/redis.module';
import { PrismaService } from '../prisma/prisma.service';
import { rebuildCollegeLeaderboard } from './leaderboard-rebuild';

/** On start, refills an empty college leaderboard from Postgres (Redis Cloud's free plan keeps nothing across restarts). */
@Injectable()
export class LeaderboardBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger(LeaderboardBootstrap.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  onApplicationBootstrap(): void {
    // Not awaited: a slow or unreachable Redis must never hold up the server coming up.
    void this.refillIfEmpty();
  }

  async refillIfEmpty(): Promise<void> {
    try {
      const result = await rebuildCollegeLeaderboard(this.prisma, this.redis);
      if (result.status === 'rebuilt')
        this.logger.log(
          `The college leaderboard was empty, rebuilt it from the database (${result.entries} players)`,
        );
    } catch (err) {
      this.logger.warn(
        `Could not check the college leaderboard: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
