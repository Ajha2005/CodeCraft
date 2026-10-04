import { ConflictException, UnauthorizedException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import type { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';

type Where = { email?: string; username?: string };
type Row = Record<string, unknown> | null;

function setup(taken: { email?: boolean; username?: boolean } = {}) {
  const user = {
    findUnique: jest.fn(
      ({ where }: { where: Where }): Promise<Row> =>
        Promise.resolve((where.email && taken.email) || (where.username && taken.username) ? { id: 'someone' } : null),
    ),
    create: jest.fn(),
  };
  const jwt = { signAsync: jest.fn().mockResolvedValue('token') };
  const service = new AuthService({ user } as unknown as PrismaService, jwt as unknown as JwtService);
  return { service, user, jwt };
}

const dto = { email: 'student@thapar.edu', password: 'password123', name: 'Student', username: 'Arjun_M' };

// what Prisma throws when a unique index is violated
const uniqueViolation = () => Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });

describe('AuthService.signup', () => {
  it('stores the username lowercase and returns a token', async () => {
    const { service, user, jwt } = setup();
    user.create.mockResolvedValue({ id: 'u1', email: dto.email, username: 'arjun_m' });

    await expect(service.signup(dto)).resolves.toEqual({ accessToken: 'token', username: 'arjun_m' });
    expect(user.create).toHaveBeenCalledWith({ data: expect.objectContaining({ email: dto.email, username: 'arjun_m' }) });
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: 'u1', email: dto.email, username: 'arjun_m' });
  });

  it('rejects an email that is already registered', async () => {
    const { service, user } = setup({ email: true });
    await expect(service.signup(dto)).rejects.toThrow(new ConflictException('Email already registered'));
    expect(user.create).not.toHaveBeenCalled();
  });

  it('rejects a username that is already taken, whatever its casing', async () => {
    const { service, user } = setup({ username: true });
    await expect(service.signup(dto)).rejects.toThrow(new ConflictException('Username already taken'));
    expect(user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { username: 'arjun_m' } }));
    expect(user.create).not.toHaveBeenCalled();
  });

  it('turns a username race (unique index, P2002) into a clear 409', async () => {
    const { service, user } = setup();
    user.create.mockRejectedValue(uniqueViolation());
    await expect(service.signup(dto)).rejects.toThrow(new ConflictException('Username already taken'));
  });

  it('turns an email race (unique index, P2002) into a clear 409', async () => {
    const { service, user } = setup();
    user.create.mockImplementation(() => {
      // by the time we look again, the other signup has taken the email
      user.findUnique.mockImplementation(({ where }: { where: Where }) => Promise.resolve(where.email ? { id: 'other' } : null));
      return Promise.reject(uniqueViolation());
    });
    await expect(service.signup(dto)).rejects.toThrow(new ConflictException('Email already registered'));
  });

  it('does not hide unexpected database errors', async () => {
    const { service, user } = setup();
    user.create.mockRejectedValue(new Error('db down'));
    await expect(service.signup(dto)).rejects.toThrow('db down');
  });
});

describe('AuthService.login', () => {
  const login = { email: dto.email, password: dto.password };

  it('puts the username in the token and in the response', async () => {
    const { service, user, jwt } = setup();
    user.findUnique.mockResolvedValue({ id: 'u1', email: dto.email, username: 'arjun_m', passwordHash: bcrypt.hashSync(dto.password, 4) });

    await expect(service.login(login)).resolves.toEqual({ accessToken: 'token', username: 'arjun_m' });
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: 'u1', email: dto.email, username: 'arjun_m' });
  });

  it('issues no token for a wrong password', async () => {
    const { service, user, jwt } = setup();
    user.findUnique.mockResolvedValue({ id: 'u1', email: dto.email, username: 'arjun_m', passwordHash: bcrypt.hashSync('other-password', 4) });

    await expect(service.login(login)).rejects.toThrow(UnauthorizedException);
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });
});

describe('AuthService.loginWithGoogle', () => {
  const google = { email: dto.email, googleId: 'g1', name: 'Student' };

  it('signs an existing user in under their own username', async () => {
    const { service, user, jwt } = setup();
    user.findUnique.mockResolvedValue({ id: 'u1', email: dto.email, username: 'arjun_m' });

    await expect(service.loginWithGoogle(google)).resolves.toEqual({ accessToken: 'token', username: 'arjun_m' });
    expect(user.create).not.toHaveBeenCalled();
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: 'u1', email: dto.email, username: 'arjun_m' });
  });

  it('gives a first-time user a generated player_xxxxxx username', async () => {
    const { service, user, jwt } = setup();
    user.create.mockImplementation(({ data }: { data: { email: string; username: string } }) =>
      Promise.resolve({ id: 'u2', email: data.email, username: data.username }),
    );

    const result = await service.loginWithGoogle(google);

    expect(result.username).toMatch(/^player_[0-9a-f]{6}$/);
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: 'u2', email: dto.email, username: result.username });
  });
});

describe('AuthService.getProfile', () => {
  it('returns the username next to the private account fields', async () => {
    const { service, user } = setup();
    user.findUnique.mockResolvedValue({ id: 'u1', email: dto.email, username: 'arjun_m', name: 'Student', flavorTextEnabled: true });

    await expect(service.getProfile('u1')).resolves.toEqual({
      userId: 'u1',
      email: dto.email,
      username: 'arjun_m',
      name: 'Student',
      flavorTextEnabled: true,
    });
    expect(user.findUnique).toHaveBeenCalledWith({ where: { id: 'u1' }, select: expect.objectContaining({ username: true }) });
  });
});
