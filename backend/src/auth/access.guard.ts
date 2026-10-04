import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { AuthUser, GUEST_FORBIDDEN_MESSAGE } from './auth-user';
import { IS_PUBLIC_KEY, NO_GUESTS_KEY } from './public.decorator';

const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** The only writes a demo (guest) session may make. Everything else that changes state is a 403. */
const GUEST_WRITE_ALLOWLIST: ReadonlyArray<{ method: string; path: string }> = [
  { method: 'POST', path: '/auth/guest' },
  { method: 'POST', path: '/run' },
];

export function isGuestWriteAllowed(method: string, path: string): boolean {
  const clean = path.replace(/\/+$/, '') || '/';
  return GUEST_WRITE_ALLOWLIST.some((rule) => rule.method === method.toUpperCase() && rule.path === clean);
}

/**
 * The one global gate. Every route needs a valid access token unless it is
 * marked @Public(); a demo (guest) token is accepted everywhere but can only
 * read, apart from the short allowlist above. WebSocket traffic is not
 * handled here: the gateways check the token during the handshake.
 */
@Injectable()
export class AccessGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);

    if (isPublic) {
      // Best effort: a valid token still identifies the caller, a missing or bad one just means anonymous.
      if (request.headers.authorization) {
        try {
          await (super.canActivate(context) as Promise<boolean>);
        } catch {
          request.user = undefined;
        }
      }
      return true;
    }

    await (super.canActivate(context) as Promise<boolean>); // throws 401 when the token is missing, expired or forged
    const user = request.user;
    if (user?.isGuest) this.enforceGuestPolicy(context, request);
    return true;
  }

  private enforceGuestPolicy(context: ExecutionContext, request: Request): void {
    const noGuests = this.reflector.getAllAndOverride<boolean>(NO_GUESTS_KEY, [context.getHandler(), context.getClass()]);
    if (noGuests) throw new ForbiddenException(GUEST_FORBIDDEN_MESSAGE);
    if (READ_ONLY_METHODS.has(request.method.toUpperCase())) return;
    if (isGuestWriteAllowed(request.method, request.path)) return;
    throw new ForbiddenException(GUEST_FORBIDDEN_MESSAGE);
  }
}
