import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../common/redis/redis.module';

const CODE_TTL_SECONDS = 60;
const CODE_SHAPE = /^[A-Za-z0-9_-]{43}$/; // 32 random bytes, base64url

/**
 * One-time codes that carry a finished Google sign-in from the API redirect to
 * the single-page app, so the access token itself never appears in a URL, a
 * browser history entry or a server log. A code works once, for 60 seconds.
 * Only its SHA-256 is stored in Redis: anyone who could read Redis (the plan
 * has no TLS) still cannot redeem a code from what is stored there.
 */
@Injectable()
export class LoginCodeService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private key(code: string): string {
    return `auth:code:${createHash('sha256').update(code).digest('hex')}`;
  }

  async issue(userId: string): Promise<string> {
    const code = randomBytes(32).toString('base64url');
    await this.redis.set(this.key(code), userId, 'EX', CODE_TTL_SECONDS);
    return code;
  }

  /** The user id the code was issued for, or null if it is unknown, expired or already used. */
  async redeem(code: string): Promise<string | null> {
    if (!CODE_SHAPE.test(code)) return null;
    const key = this.key(code);
    const result = await this.redis.multi().get(key).del(key).exec(); // read and delete in one step: single use
    const value = result?.[0]?.[1];
    return typeof value === 'string' ? value : null;
  }
}
