import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { AuthUser } from '../../auth/auth-user';

/**
 * Rate limiting keyed on who is asking, not only on the network address:
 *  - a signed-in user is counted per account, so a campus sharing one NAT
 *    address does not share one budget;
 *  - a demo (guest) session is counted per IP, because anyone can mint as many
 *    guest tokens as they like and a per-token limit would mean nothing;
 *  - anonymous callers (the demo sign-up itself) are counted per IP.
 *
 * It reads `req.user`, so list JwtAuthGuard before it. `req.ip` is the real
 * visitor only when `trust proxy` matches the proxies in front of the app
 * (TRUST_PROXY_HOPS, see main.ts); without it every visitor shares the
 * proxy's address and with it one budget.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, any>): Promise<string> {
    const user = req.user as AuthUser | undefined;
    if (user && !user.isGuest) return Promise.resolve(`u:${user.userId}`);
    return Promise.resolve(`ip:${String(req.ip)}`);
  }
}
