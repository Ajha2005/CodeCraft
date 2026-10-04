import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthUser } from './auth-user';

/** The caller as AccessGuard resolved it; undefined only on @Public() routes called without a token. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser | undefined => {
  return ctx.switchToHttp().getRequest<{ user?: AuthUser }>().user;
});
