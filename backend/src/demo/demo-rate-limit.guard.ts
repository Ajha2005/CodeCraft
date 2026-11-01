import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';

const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 30;

/**
 * Demo endpoints need no login, so they are the one place anybody on the
 * internet can make the judge run code. A small per-address allowance keeps a
 * single visitor from monopolising it. In memory is enough: it only has to blunt
 * abuse, and a restart simply forgives everyone.
 */
@Injectable()
export class DemoRateLimitGuard implements CanActivate {
  private readonly hits = new Map<string, number[]>();

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ ip?: string; method: string }>();
    if (req.method !== 'POST') return true;

    const now = Date.now();
    const key = req.ip ?? 'unknown';
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
    if (recent.length >= MAX_PER_WINDOW) {
      throw new HttpException('Too many demo submissions - take a short break and try again.', HttpStatus.TOO_MANY_REQUESTS);
    }
    recent.push(now);
    this.hits.set(key, recent);

    // drop addresses that went quiet so the map cannot grow without bound
    if (this.hits.size > 5000) {
      for (const [ip, times] of this.hits) if (times.every((t) => now - t >= WINDOW_MS)) this.hits.delete(ip);
    }
    return true;
  }
}
