import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { AuthUser } from '../../auth/auth-user';

/**
 * Rate limiting keyed on who is asking, not only on the network address:
 *  - a signed-in user is counted per account, so a whole campus sharing one
 *    NAT address does not share one budget;
 *  - a demo (guest) session is counted per IP, because anyone can mint as many
 *    guest tokens as they like and a per-token limit would mean nothing;
 *  - anonymous callers (login, Google, guest sign-up) are counted per IP.
 * `req.ip` is the real client address because `trust proxy` is set for the
 * single Nginx hop in front of the app.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, any>): Promise<string> {
    const user = req.user as AuthUser | undefined;
    if (user && !user.isGuest) return Promise.resolve(`u:${user.userId}`);
    return Promise.resolve(`${user ? 'g' : 'ip'}:${String(req.ip)}`);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true; // sockets are limited at the handshake and by the proxy
    return super.canActivate(context);
  }
}
