import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';

const config = {
  get: (_key: string, fallback: string) => fallback,
} as unknown as ConfigService;

describe('JwtStrategy.validate', () => {
  const strategy = new JwtStrategy(config);

  it('keeps accounts signed in: a token with no role is an account', () => {
    expect(strategy.validate({ sub: 'u1', email: 'a@thapar.edu' })).toEqual({
      userId: 'u1',
      email: 'a@thapar.edu',
      role: 'USER',
      isGuest: false,
    });
  });

  it('turns a guest token into a guest caller', () => {
    expect(strategy.validate({ sub: 'guest:3b0f', role: 'GUEST' })).toEqual({
      userId: 'guest:3b0f',
      role: 'GUEST',
      isGuest: true,
    });
  });

  it.each([
    [
      'a guest role on an account id',
      { sub: '6f1c2d3e-0000-4000-8000-000000000001', role: 'GUEST' as const },
    ],
    [
      'an account role on a guest id',
      { sub: 'guest:3b0f', role: 'USER' as const },
    ],
    ['a guest id with no role', { sub: 'guest:3b0f' }],
    ['no subject', { role: 'USER' as const } as never],
  ])('refuses %s', (_name, payload) => {
    expect(() => strategy.validate(payload)).toThrow(UnauthorizedException);
  });
});
