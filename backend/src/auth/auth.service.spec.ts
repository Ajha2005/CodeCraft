import { ConflictException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import type { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';

type Where = { email?: string; username?: string };

function setup(taken: { email?: boolean; username?: boolean } = {}) {
  const user = {
    findUnique: jest.fn(({ where }: { where: Where }) =>
      Promise.resolve((where.email && taken.email) || (where.username && taken.username) ? { id: 'someone' } : null),
    ),
    create: jest.fn(),
  };
  const jwt = { signAsync: jest.fn().mockResolvedValue('token') };
  const service = new AuthService({ user } as unknown as PrismaService, jwt as unknown as JwtService);
  return { service, user };
}

const dto = { email: 'student@thapar.edu', password: 'password123', name: 'Student', username: 'Arjun_M' };

describe('AuthService.signup', () => {
  it('stores the username lowercase and returns a token', async () => {
    const { service, user } = setup();
    user.create.mockResolvedValue({ id: 'u1', email: dto.email });

    await expect(service.signup(dto)).resolves.toEqual({ accessToken: 'token' });
    expect(user.create).toHaveBeenCalledWith({ data: expect.objectContaining({ email: dto.email, username: 'arjun_m' }) });
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
    user.create.mockRejectedValue({ code: 'P2002' });
    await expect(service.signup(dto)).rejects.toThrow(new ConflictException('Username already taken'));
  });

  it('turns an email race (unique index, P2002) into a clear 409', async () => {
    const { service, user } = setup();
    user.create.mockImplementation(() => {
      // by the time we look again, the other signup has taken the email
      user.findUnique.mockImplementation(({ where }: { where: Where }) => Promise.resolve(where.email ? { id: 'other' } : null));
      return Promise.reject({ code: 'P2002' });
    });
    await expect(service.signup(dto)).rejects.toThrow(new ConflictException('Email already registered'));
  });

  it('does not hide unexpected database errors', async () => {
    const { service, user } = setup();
    user.create.mockRejectedValue(new Error('db down'));
    await expect(service.signup(dto)).rejects.toThrow('db down');
  });
});
