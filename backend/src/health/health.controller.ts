import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Redis } from 'ioredis';
import { Public } from '../auth/public.decorator';
import { REDIS_CLIENT } from '../common/redis/redis.module';
import { PrismaService } from '../prisma/prisma.service';

const CHECK_TIMEOUT_MS = 2000;

function withTimeout<T>(work: Promise<T>): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS).unref()),
  ]);
}

/** For uptime monitors and the deploy checklist. Reveals nothing about versions or configuration. */
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** Liveness: the process is up and answering. */
  @Get()
  alive() {
    return { status: 'ok' };
  }

  /** Readiness: the database and Redis answer too. 503 if either does not. */
  @Get('ready')
  async ready() {
    const [db, redis] = await Promise.all([
      withTimeout(this.prisma.$queryRaw`SELECT 1`).then(() => 'up', () => 'down'),
      withTimeout(this.redis.ping()).then(() => 'up', () => 'down'),
    ]);
    const body = { status: db === 'up' && redis === 'up' ? 'ok' : 'degraded', db, redis };
    if (body.status !== 'ok') throw new ServiceUnavailableException(body);
    return body;
  }
}
