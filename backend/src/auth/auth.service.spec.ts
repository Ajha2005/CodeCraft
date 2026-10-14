import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import type { PrismaService } from '../prisma/prisma.service';
import {
  GUEST_FORBIDDEN_MESSAGE,
  userFromPayload,
  type AccessTokenPayload,
  type AuthUser,
} from './auth-user';
import { AuthService } from './auth.service';

function setup() {
  const user = { findUnique: jest.fn(), create: jest.fn() };
  const jwt = { signAsync: jest.fn().mockResolvedValue('token') };
  const service = new AuthService(
    { user } as unknown as PrismaService,
    jwt as unknown as JwtService,
  );
  return { service, user, jwt };
}

const dto = {
  email: 'student@thapar.edu',
  password: 'password123',
  name: 'Student',
};
const account: AuthUser = { userId: 'u1', role: 'USER', isGuest: false };

describe('AuthService.signup', () => {
  it('creates the account under the name given at signup and returns a token', async () => {
    const { service, user, jwt } = setup();
    user.findUnique.mockResolvedValue(null);
    user.create.mockResolvedValue({ id: 'u1', email: dto.email });

    await expect(service.signup(dto)).resolves.toEqual({
      accessToken: 'token',
    });
    expect(user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ email: dto.email, name: 'Student' }),
    });
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: 'u1', email: dto.email });
  });

  it('rejects an email that is already registered', async () => {
    const { service, user } = setup();
    user.findUnique.mockResolvedValue({ id: 'someone' });

    await expect(service.signup(dto)).rejects.toThrow(
      new ConflictException('Email already registered'),
    );
    expect(user.create).not.toHaveBeenCalled();
  });
});

describe('AuthService.login', () => {
  const login = { email: dto.email, password: dto.password };

  it('returns a token for the right password', async () => {
    const { service, user, jwt } = setup();
    user.findUnique.mockResolvedValue({
      id: 'u1',
      email: dto.email,
      passwordHash: bcrypt.hashSync(dto.password, 4),
    });

    await expect(service.login(login)).resolves.toEqual({
      accessToken: 'token',
    });
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: 'u1', email: dto.email });
  });

  it('issues no token for a wrong password', async () => {
    const { service, user, jwt } = setup();
    user.findUnique.mockResolvedValue({
      id: 'u1',
      email: dto.email,
      passwordHash: bcrypt.hashSync('other-password', 4),
    });

    await expect(service.login(login)).rejects.toThrow(UnauthorizedException);
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });
});

describe('AuthService.loginWithGoogle', () => {
  const google = { email: dto.email, googleId: 'g1', name: 'Student' };

  it('signs an existing user in without creating another account', async () => {
    const { service, user, jwt } = setup();
    user.findUnique.mockResolvedValue({ id: 'u1', email: dto.email });

    await expect(service.loginWithGoogle(google)).resolves.toEqual({
      accessToken: 'token',
    });
    expect(user.create).not.toHaveBeenCalled();
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: 'u1', email: dto.email });
  });

  it('creates a first-time user under their Google name', async () => {
    const { service, user, jwt } = setup();
    user.findUnique.mockResolvedValue(null);
    user.create.mockResolvedValue({ id: 'u2', email: dto.email });

    await expect(service.loginWithGoogle(google)).resolves.toEqual({
      accessToken: 'token',
    });
    expect(user.create).toHaveBeenCalledWith({
      data: { email: dto.email, googleId: 'g1', name: 'Student' },
    });
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: 'u2', email: dto.email });
  });
});

describe('AuthService.getProfile', () => {
  it('returns the account fields the app shows, name included', async () => {
    const { service, user } = setup();
    user.findUnique.mockResolvedValue({
      id: 'u1',
      email: dto.email,
      name: 'Student',
      flavorTextEnabled: true,
    });

    await expect(service.getProfile(account)).resolves.toEqual({
      userId: 'u1',
      email: dto.email,
      name: 'Student',
      flavorTextEnabled: true,
    });
    expect(user.findUnique).toHaveBeenCalledWith({
      where: { id: 'u1' },
      select: { id: true, email: true, name: true, flavorTextEnabled: true },
    });
  });

  it('rejects a user that no longer exists', async () => {
    const { service, user } = setup();
    user.findUnique.mockResolvedValue(null);

    await expect(
      service.getProfile({ ...account, userId: 'gone' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('describes a demo session without any lookup, and without anything personal', async () => {
    const { service, user } = setup();

    const profile = await service.getProfile({
      userId: 'guest:abc',
      role: 'GUEST',
      isGuest: true,
    });

    expect(profile).toEqual({
      userId: 'guest:abc',
      email: '',
      name: 'Demo visitor',
      isGuest: true,
      flavorTextEnabled: true,
    });
    expect(user.findUnique).not.toHaveBeenCalled();
  });

  it('does not add anything to what an account already sees', async () => {
    const { service, user } = setup();
    user.findUnique.mockResolvedValue({
      id: 'u1',
      email: dto.email,
      name: 'Student',
      flavorTextEnabled: false,
    });

    expect(Object.keys(await service.getProfile(account)).sort()).toEqual([
      'email',
      'flavorTextEnabled',
      'name',
      'userId',
    ]);
  });
});

describe('AuthService.issueGuestToken', () => {
  it('signs a two-hour token for a guest id and nothing else personal', async () => {
    const { service, jwt, user } = setup();

    const result = await service.issueGuestToken();

    expect(result).toEqual({
      accessToken: 'token',
      role: 'GUEST',
      expiresIn: 7200,
    });
    const [payload, options] = jwt.signAsync.mock.calls[0];
    expect(payload).toEqual({
      sub: expect.stringMatching(/^guest:[0-9a-f-]{36}$/),
      role: 'GUEST',
    });
    expect(options).toEqual({ expiresIn: 7200 });
    // a demo session never touches the database
    expect(user.findUnique).not.toHaveBeenCalled();
    expect(user.create).not.toHaveBeenCalled();
  });

  it('gives every visitor a different id', async () => {
    const { service, jwt } = setup();
    await service.issueGuestToken();
    await service.issueGuestToken();
    const [first, second] = jwt.signAsync.mock.calls.map(
      ([payload]) => (payload as { sub: string }).sub,
    );
    expect(first).not.toEqual(second);
  });

  it('really lasts two hours, whatever the lifetime of an account token is', async () => {
    // a real signer this time: the module default is a day, and the guest token must override it
    const real = new JwtService({
      secret: 'test-secret',
      signOptions: { expiresIn: '1d' },
    });
    const service = new AuthService(
      { user: {} } as unknown as PrismaService,
      real,
    );

    const { accessToken } = await service.issueGuestToken();
    const claims = real.verify<
      AccessTokenPayload & { iat: number; exp: number }
    >(accessToken);

    expect(claims.exp - claims.iat).toBe(7200);
    expect(userFromPayload(claims)).toEqual({
      userId: claims.sub,
      role: 'GUEST',
      isGuest: true,
    });
    expect(Object.keys(claims).sort()).toEqual(['exp', 'iat', 'role', 'sub']); // no email, no name
  });

  it('refuses writes with a message fit to show the visitor', () => {
    expect(GUEST_FORBIDDEN_MESSAGE).toBe(
      'Demo mode is read-only. Sign in with a Thapar ID to do this.',
    );
  });
});
