import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';

const STRONG_SECRET = 'Zx9!kQ2#vL7@pR4$wN8%cT5^yB1&hG6*mD3(sF0)';

describe('JwtStrategy', () => {
  const original = process.env.JWT_SECRET;
  beforeEach(() => {
    process.env.JWT_SECRET = STRONG_SECRET;
  });
  afterAll(() => {
    if (original === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = original;
  });

  it('turns a user token into the caller', () => {
    expect(new JwtStrategy().validate({ sub: '6f1c2d3e-0000-4000-8000-000000000001', role: 'USER' })).toEqual({
      userId: '6f1c2d3e-0000-4000-8000-000000000001',
      role: 'USER',
      isGuest: false,
    });
  });

  it('turns a guest token into a guest caller', () => {
    expect(new JwtStrategy().validate({ sub: 'guest:3b0f', role: 'GUEST' })).toEqual({ userId: 'guest:3b0f', role: 'GUEST', isGuest: true });
  });

  it.each([
    ['a guest role on a user id', { sub: '6f1c2d3e-0000-4000-8000-000000000001', role: 'GUEST' }],
    ['a user role on a guest id', { sub: 'guest:3b0f', role: 'USER' }],
    ['no role', { sub: '6f1c2d3e-0000-4000-8000-000000000001' }],
    ['an unknown role', { sub: 'u1', role: 'ADMIN' }],
    ['no subject', { role: 'USER' }],
    ['a numeric subject', { sub: 42, role: 'USER' }],
  ])('refuses %s', (_name, payload) => {
    expect(() => new JwtStrategy().validate(payload as never)).toThrow(UnauthorizedException);
  });

  it('will not even be created without a strong secret', () => {
    delete process.env.JWT_SECRET;
    expect(() => new JwtStrategy()).toThrow(/JWT_SECRET is not set/);
    process.env.JWT_SECRET = 'dev_secret_change_this_in_production';
    expect(() => new JwtStrategy()).toThrow(/JWT_SECRET/);
  });
});
