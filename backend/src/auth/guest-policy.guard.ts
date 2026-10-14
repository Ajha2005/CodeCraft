import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import {
  AccessTokenPayload,
  GUEST_FORBIDDEN_MESSAGE,
  userFromPayload,
} from './auth-user';
import { GUEST_CAN_WRITE_KEY, NO_GUESTS_KEY } from './guest.decorators';

const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** The token in an `Authorization: Bearer <token>` header, if there is one. */
function bearerToken(request: Request): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return null;
  const [scheme, token, ...rest] = header.trim().split(/\s+/);
  return scheme?.toLowerCase() === 'bearer' && token && rest.length === 0
    ? token
    : null;
}

/**
 * Makes a demo (guest) session read-only. It runs in front of every HTTP route
 * and only ever acts on a request that carries a valid guest token:
 *  - a route marked @NoGuests() is refused, even for GET;
 *  - GET, HEAD and OPTIONS go through;
 *  - any other method is refused unless the route is marked @GuestCanWrite().
 * Requests with no token, an account token, or a token that does not verify are
 * not its business: they behave exactly as before, and each route's own guard
 * still decides whether a login is needed. WebSocket traffic is not handled
 * here; the gateways check the token in their handshake.
 *
 * The decision reads the metadata of the handler Nest actually resolved, not
 * the URL, so there is no path spelling (case, trailing slash, encoding) that
 * could get a write past it.
 */
@Injectable()
export class GuestPolicyGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = bearerToken(request);
    if (!token || !(await this.isGuestToken(token))) return true;

    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(NO_GUESTS_KEY, targets)) {
      throw new ForbiddenException(GUEST_FORBIDDEN_MESSAGE);
    }
    if (READ_ONLY_METHODS.has(request.method.toUpperCase())) return true;
    if (this.reflector.getAllAndOverride<boolean>(GUEST_CAN_WRITE_KEY, targets))
      return true;
    throw new ForbiddenException(GUEST_FORBIDDEN_MESSAGE);
  }

  private async isGuestToken(token: string): Promise<boolean> {
    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
      return userFromPayload(payload)?.isGuest === true;
    } catch {
      // Expired, forged or malformed: not a guest token. Routes that need a login answer 401 themselves.
      return false;
    }
  }
}
