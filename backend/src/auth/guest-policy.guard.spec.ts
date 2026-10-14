import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { GUEST_FORBIDDEN_MESSAGE } from './auth-user';
import { GuestPolicyGuard } from './guest-policy.guard';
import { GuestCanWrite, NoGuests } from './guest.decorators';

class Routes {
  plain() {}
  @GuestCanWrite() allowedWrite() {}
  @NoGuests() accountOnly() {}
}

@NoGuests()
class AccountOnlyController {
  plain() {}
}

type Handler = (...args: never[]) => void;
type Controller = new () => object;

/** The method Nest would resolve for a route: what `context.getHandler()` returns. */
const handlerOf = (controller: Controller, name: string): Handler =>
  (controller.prototype as unknown as Record<string, Handler>)[name];

const plain = handlerOf(Routes, 'plain');
const allowedWrite = handlerOf(Routes, 'allowedWrite');
const accountOnly = handlerOf(Routes, 'accountOnly');

const jwt = new JwtService({ secret: 'test-secret' });
const guard = new GuestPolicyGuard(jwt, new Reflector());

const guestToken = () =>
  jwt.sign({ sub: 'guest:3b0f', role: 'GUEST' }, { expiresIn: 60 });
const accountToken = () =>
  jwt.sign({ sub: 'u1', email: 'a@thapar.edu' }, { expiresIn: 60 });

function ctx(
  method: string,
  handler: Handler,
  authorization?: string,
  controller: Controller = Routes,
  type = 'http',
) {
  return {
    getType: () => type,
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({
      getRequest: () => ({
        method,
        headers: authorization ? { authorization } : {},
      }),
    }),
  } as unknown as ExecutionContext;
}

const refused = () =>
  expect.objectContaining({ message: GUEST_FORBIDDEN_MESSAGE });

describe('GuestPolicyGuard', () => {
  describe('a demo (guest) session', () => {
    it.each(['GET', 'HEAD', 'OPTIONS', 'get'])(
      'may read (%s)',
      async (method) => {
        await expect(
          guard.canActivate(ctx(method, plain, `Bearer ${guestToken()}`)),
        ).resolves.toBe(true);
      },
    );

    it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'post'])(
      'may not write (%s) unless the route says so',
      async (method) => {
        const attempt = guard.canActivate(
          ctx(method, plain, `Bearer ${guestToken()}`),
        );
        await expect(attempt).rejects.toBeInstanceOf(ForbiddenException);
        await expect(attempt).rejects.toEqual(refused());
      },
    );

    it('may write where the route is marked @GuestCanWrite()', async () => {
      await expect(
        guard.canActivate(ctx('POST', allowedWrite, `Bearer ${guestToken()}`)),
      ).resolves.toBe(true);
    });

    it('is refused on an @NoGuests() route even to read', async () => {
      await expect(
        guard.canActivate(ctx('GET', accountOnly, `Bearer ${guestToken()}`)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('is refused on every route of an @NoGuests() controller', async () => {
      await expect(
        guard.canActivate(
          ctx(
            'GET',
            handlerOf(AccountOnlyController, 'plain'),
            `Bearer ${guestToken()}`,
            AccountOnlyController,
          ),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('is recognised whatever the case of the Bearer scheme', async () => {
      await expect(
        guard.canActivate(ctx('POST', plain, `bearer ${guestToken()}`)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('everyone else is none of its business', () => {
    it('lets an account write', async () => {
      await expect(
        guard.canActivate(ctx('POST', plain, `Bearer ${accountToken()}`)),
      ).resolves.toBe(true);
    });

    it('lets an account into an @NoGuests() route', async () => {
      await expect(
        guard.canActivate(ctx('GET', accountOnly, `Bearer ${accountToken()}`)),
      ).resolves.toBe(true);
    });

    it('lets a request with no token through (each route decides whether a login is needed)', async () => {
      await expect(guard.canActivate(ctx('POST', plain))).resolves.toBe(true);
    });

    it('does not treat a token that does not verify as a guest', async () => {
      const expired = jwt.sign(
        { sub: 'guest:3b0f', role: 'GUEST' },
        { expiresIn: -10 },
      );
      const forged = new JwtService({ secret: 'another-secret' }).sign({
        sub: 'guest:3b0f',
        role: 'GUEST',
      });
      for (const token of [expired, forged, 'not-a-token']) {
        await expect(
          guard.canActivate(ctx('POST', plain, `Bearer ${token}`)),
        ).resolves.toBe(true);
      }
    });

    it('does not treat a guest role on an account id as a guest (the strategy refuses it with 401)', async () => {
      const mismatched = jwt.sign(
        { sub: '6f1c2d3e-0000-4000-8000-000000000001', role: 'GUEST' },
        { expiresIn: 60 },
      );
      await expect(
        guard.canActivate(ctx('POST', plain, `Bearer ${mismatched}`)),
      ).resolves.toBe(true);
    });

    it('ignores an Authorization header that is not a Bearer token', async () => {
      for (const header of [
        `Basic ${guestToken()}`,
        `Bearer ${guestToken()} extra`,
        'Bearer',
      ]) {
        await expect(
          guard.canActivate(ctx('POST', plain, header)),
        ).resolves.toBe(true);
      }
    });

    it('does not handle WebSocket traffic (the gateways check the handshake)', async () => {
      await expect(
        guard.canActivate(
          ctx('POST', plain, `Bearer ${guestToken()}`, Routes, 'ws'),
        ),
      ).resolves.toBe(true);
    });
  });
});
