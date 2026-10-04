import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthService, BCRYPT_COST } from './auth.service';

// Keep the real bcrypt, but make `compare` observable so the timing-equalising path can be asserted.
jest.mock('bcrypt', () => {
  const actual = jest.requireActual('bcrypt');
  return { ...actual, compare: jest.fn(actual.compare) };
});
import { JWT_ALGORITHM, JWT_AUDIENCE, JWT_ISSUER, jwtModuleOptions } from './jwt.config';

const SECRET = 'Zx9!kQ2#vL7@pR4$wN8%cT5^yB1&hG6*mD3(sF0)';

function setup() {
  process.env.JWT_SECRET = SECRET;
  const user = {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    update: jest.fn().mockResolvedValue({}),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const loginCodes = { redeem: jest.fn(), issue: jest.fn() };
  const jwt = new JwtService(jwtModuleOptions());
  const service = new AuthService({ user } as never, jwt, audit as never, loginCodes as never);
  return { service, user, audit, loginCodes, jwt };
}

const claims = (jwt: JwtService, token: string) => jwt.decode(token) as Record<string, unknown>;

afterEach(() => {
  delete process.env.PASSWORD_LOGIN_ENABLED;
});

describe('AuthService.issueGuestToken', () => {
  it('signs a two-hour guest token with a guest id and nothing else personal', async () => {
    const { service, jwt, user } = setup();
    const { accessToken, role, expiresIn } = await service.issueGuestToken();

    const payload = claims(jwt, accessToken);
    expect(role).toBe('GUEST');
    expect(expiresIn).toBe(7200);
    expect(payload.role).toBe('GUEST');
    expect(String(payload.sub)).toMatch(/^guest:[0-9a-f-]{36}$/);
    expect(Number(payload.exp) - Number(payload.iat)).toBe(7200);
    expect(payload.iss).toBe(JWT_ISSUER);
    expect(payload.aud).toBe(JWT_AUDIENCE);
    expect(Object.keys(payload).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'role', 'sub']);
    // a guest session never touches the database
    expect(Object.values(user).every((fn) => (fn as jest.Mock).mock.calls.length === 0)).toBe(true);
  });

  it('gives every session its own identity, signed with the pinned algorithm', async () => {
    const { service, jwt } = setup();
    const [a, b] = [await service.issueGuestToken(), await service.issueGuestToken()];
    expect(claims(jwt, a.accessToken).sub).not.toBe(claims(jwt, b.accessToken).sub);
    const header = JSON.parse(Buffer.from(a.accessToken.split('.')[0], 'base64url').toString());
    expect(header.alg).toBe(JWT_ALGORITHM);
  });

  it('is rejected if it is checked against a different secret', async () => {
    const { service } = setup();
    const { accessToken } = await service.issueGuestToken();
    const other = new JwtService({ ...jwtModuleOptions(), secret: 'a-completely-different-secret-value-0123456789' });
    await expect(other.verifyAsync(accessToken)).rejects.toThrow();
  });
});

describe('AuthService.signToken', () => {
  it('carries only the user id and the role: no email, no name, no username', async () => {
    const { service, jwt } = setup();
    const { accessToken } = await service.signToken('11111111-1111-4111-8111-111111111111');
    const payload = claims(jwt, accessToken);
    expect(payload).toMatchObject({ sub: '11111111-1111-4111-8111-111111111111', role: 'USER' });
    expect(Object.keys(payload).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'role', 'sub']);
  });
});

describe('AuthService.login (password sign-in)', () => {
  it('is switched off unless PASSWORD_LOGIN_ENABLED=true, and then touches nothing', async () => {
    const { service, user } = setup();
    await expect(service.login({ email: 'a@thapar.edu', password: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(user.findFirst).not.toHaveBeenCalled();
  });

  describe('when enabled', () => {
    beforeEach(() => {
      process.env.PASSWORD_LOGIN_ENABLED = 'true';
    });

    it('does the same bcrypt work for an unknown address as for a wrong password', async () => {
      const { service, user } = setup();
      const compare = bcrypt.compare as unknown as jest.Mock;
      compare.mockClear();
      user.findFirst.mockResolvedValue(null);

      await expect(service.login({ email: 'ghost@thapar.edu', password: 'whatever1' })).rejects.toThrow(new UnauthorizedException('Invalid credentials'));
      expect(compare).toHaveBeenCalledTimes(1);

      compare.mockClear();
      user.findFirst.mockResolvedValue({ id: 'u1', passwordHash: await bcrypt.hash('right-password', 4) });
      await expect(service.login({ email: 'real@thapar.edu', password: 'wrong-password' })).rejects.toThrow(new UnauthorizedException('Invalid credentials'));
      expect(compare).toHaveBeenCalledTimes(1);
    });

    it('gives one generic error for an unknown address, a wrong password, a Google-only account and an unusable address', async () => {
      const { service, user } = setup();
      const message = async (email: string, row: unknown) => {
        user.findFirst.mockResolvedValue(row);
        return service.login({ email, password: 'whatever1' }).catch((e: Error) => e.message);
      };
      const hash = await bcrypt.hash('right-password', 4);
      const results = await Promise.all([
        message('ghost@thapar.edu', null),
        message('real@thapar.edu', { id: 'u1', passwordHash: hash }),
        message('google@thapar.edu', { id: 'u2', passwordHash: null }),
        message('not an address', null),
      ]);
      expect(new Set(results)).toEqual(new Set(['Invalid credentials']));
    });

    it('matches the address case-insensitively and returns a token without personal claims', async () => {
      const { service, user, jwt } = setup();
      user.findFirst.mockResolvedValue({ id: '22222222-2222-4222-8222-222222222222', passwordHash: await bcrypt.hash('right-password', BCRYPT_COST) });

      const { accessToken } = await service.login({ email: ' Real@Thapar.EDU ', password: 'right-password' });

      expect(user.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { email: { equals: 'real@thapar.edu', mode: 'insensitive' } } }));
      expect(claims(jwt, accessToken)).toMatchObject({ sub: '22222222-2222-4222-8222-222222222222', role: 'USER' });
    });

    it('upgrades an old cost-10 hash to the current cost after a good sign-in', async () => {
      const { service, user } = setup();
      user.findFirst.mockResolvedValue({ id: 'u1', passwordHash: await bcrypt.hash('right-password', 10) });
      await service.login({ email: 'real@thapar.edu', password: 'right-password' });
      const stored = user.update.mock.calls[0][0].data.passwordHash as string;
      expect(bcrypt.getRounds(stored)).toBe(BCRYPT_COST);
      expect(BCRYPT_COST).toBeGreaterThanOrEqual(12);
    });
  });
});

describe('AuthService.findOrCreateGoogleUser', () => {
  const google = { email: 'Arjun.M@Thapar.edu', googleId: 'g-123' };

  it('signs an already linked Google identity straight in', async () => {
    const { service, user } = setup();
    user.findUnique.mockResolvedValue({ id: 'u1' });
    await expect(service.findOrCreateGoogleUser(google)).resolves.toBe('u1');
    expect(user.create).not.toHaveBeenCalled();
  });

  it('links a password account with the same address and wipes its password (pre-registration cannot survive)', async () => {
    const { service, user, audit } = setup();
    user.findUnique.mockResolvedValue(null);
    user.findMany.mockResolvedValue([{ id: 'u9', googleId: null, passwordHash: 'attacker-chosen-hash' }]);

    await expect(service.findOrCreateGoogleUser(google, '203.0.113.9')).resolves.toBe('u9');

    expect(user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { email: { equals: 'arjun.m@thapar.edu', mode: 'insensitive' } } }));
    expect(user.update).toHaveBeenCalledWith({ where: { id: 'u9' }, data: { googleId: 'g-123', passwordHash: null } });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.google_link', actorId: 'u9', metadata: { passwordCleared: true }, ip: '203.0.113.9' }),
    );
  });

  it('records that nothing had to be wiped when the old account had no password', async () => {
    const { service, user, audit } = setup();
    user.findUnique.mockResolvedValue(null);
    user.findMany.mockResolvedValue([{ id: 'u9', googleId: null, passwordHash: null }]);
    await service.findOrCreateGoogleUser(google);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ metadata: { passwordCleared: false } }));
  });

  it('picks the oldest account when the same address exists in two letter cases', async () => {
    const { service, user } = setup();
    user.findUnique.mockResolvedValue(null);
    user.findMany.mockResolvedValue([
      { id: 'older', googleId: null, passwordHash: null },
      { id: 'newer', googleId: null, passwordHash: null },
    ]);
    await expect(service.findOrCreateGoogleUser(google)).resolves.toBe('older');
    expect(user.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { createdAt: 'asc' } }));
  });

  it('refuses an address that is already linked to a different Google identity', async () => {
    const { service, user } = setup();
    user.findUnique.mockResolvedValue(null);
    user.findMany.mockResolvedValue([{ id: 'u9', googleId: 'someone-else', passwordHash: null }]);
    await expect(service.findOrCreateGoogleUser(google)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(user.update).not.toHaveBeenCalled();
  });

  it('creates a first-time user with a generated handle and the canonical address, storing no real name', async () => {
    const { service, user, audit } = setup();
    user.findUnique.mockResolvedValue(null); // no linked identity; every generated username is free
    user.create.mockResolvedValue({ id: 'new-user' });

    await expect(service.findOrCreateGoogleUser(google)).resolves.toBe('new-user');

    const data = user.create.mock.calls[0][0].data;
    expect(data).toEqual({ email: 'arjun.m@thapar.edu', googleId: 'g-123', username: expect.stringMatching(/^player_[0-9a-f]{6}$/) });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.account_created', actorId: 'new-user' }));
  });

  it('survives two first sign-ins racing: the unique index decides and the loser reuses the winner', async () => {
    const { service, user } = setup();
    user.findUnique.mockResolvedValue(null);
    user.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
    user.findFirst.mockResolvedValue({ id: 'winner' });
    await expect(service.findOrCreateGoogleUser(google)).resolves.toBe('winner');
  });

  it('does not hide unexpected database errors', async () => {
    const { service, user } = setup();
    user.findUnique.mockResolvedValue(null);
    user.create.mockRejectedValue(new Error('connection lost'));
    await expect(service.findOrCreateGoogleUser(google)).rejects.toThrow('connection lost');
  });

  it.each(['someone@gmail.com', 'a@thapar.edu.evil.com', '"a@evil.com"@thapar.edu'])('refuses %s even if it reaches the service', async (email) => {
    const { service, user } = setup();
    await expect(service.findOrCreateGoogleUser({ email, googleId: 'g' })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(user.findUnique).not.toHaveBeenCalled();
  });
});

describe('AuthService.exchangeLoginCode', () => {
  it('turns a valid one-time code into a token for that user', async () => {
    const { service, user, loginCodes, jwt } = setup();
    loginCodes.redeem.mockResolvedValue('33333333-3333-4333-8333-333333333333');
    user.findUnique.mockResolvedValue({ id: '33333333-3333-4333-8333-333333333333' });
    const { accessToken } = await service.exchangeLoginCode('A'.repeat(43));
    expect(claims(jwt, accessToken)).toMatchObject({ sub: '33333333-3333-4333-8333-333333333333', role: 'USER' });
  });

  it('refuses an unknown, expired or used code, and a code for a user who no longer exists', async () => {
    const { service, user, loginCodes } = setup();
    loginCodes.redeem.mockResolvedValue(null);
    await expect(service.exchangeLoginCode('A'.repeat(43))).rejects.toBeInstanceOf(UnauthorizedException);

    loginCodes.redeem.mockResolvedValue('gone');
    user.findUnique.mockResolvedValue(null);
    await expect(service.exchangeLoginCode('A'.repeat(43))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('AuthService.getProfile', () => {
  it('describes a demo session without any lookup', async () => {
    const { service, user } = setup();
    const profile = await service.getProfile({ userId: 'guest:abc', role: 'GUEST', isGuest: true });
    expect(profile).toEqual({ userId: 'guest:abc', username: 'guest', role: 'GUEST', isGuest: true, flavorTextEnabled: true });
    expect(user.findUnique).not.toHaveBeenCalled();
  });

  it('returns the username and settings of a real user, never the email or real name', async () => {
    const { service, user } = setup();
    user.findUnique.mockResolvedValue({ id: 'u1', username: 'arjun_m', flavorTextEnabled: false });
    const profile = await service.getProfile({ userId: 'u1', role: 'USER', isGuest: false });
    expect(profile).toEqual({ userId: 'u1', username: 'arjun_m', role: 'USER', isGuest: false, flavorTextEnabled: false });
    expect(user.findUnique).toHaveBeenCalledWith({ where: { id: 'u1' }, select: { id: true, username: true, flavorTextEnabled: true } });
  });

  it('is a 401 for a token whose user was deleted', async () => {
    const { service, user } = setup();
    user.findUnique.mockResolvedValue(null);
    await expect(service.getProfile({ userId: 'u1', role: 'USER', isGuest: false })).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
