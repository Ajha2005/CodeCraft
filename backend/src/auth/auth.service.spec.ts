import { ConflictException, UnauthorizedException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import type { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';

function setup() {
  const user = { findUnique: jest.fn(), create: jest.fn() };
  const jwt = { signAsync: jest.fn().mockResolvedValue('token') };
  const service = new AuthService({ user } as unknown as PrismaService, jwt as unknown as JwtService);
  return { service, user, jwt };
}

const dto = { email: 'student@thapar.edu', password: 'password123', name: 'Student' };

describe('AuthService.signup', () => {
  it('creates the account under the name given at signup and returns a token', async () => {
    const { service, user, jwt } = setup();
    user.findUnique.mockResolvedValue(null);
    user.create.mockResolvedValue({ id: 'u1', email: dto.email });

    await expect(service.signup(dto)).resolves.toEqual({ accessToken: 'token' });
    expect(user.create).toHaveBeenCalledWith({ data: expect.objectContaining({ email: dto.email, name: 'Student' }) });
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: 'u1', email: dto.email });
  });

  it('rejects an email that is already registered', async () => {
    const { service, user } = setup();
    user.findUnique.mockResolvedValue({ id: 'someone' });

    await expect(service.signup(dto)).rejects.toThrow(new ConflictException('Email already registered'));
    expect(user.create).not.toHaveBeenCalled();
  });
});

describe('AuthService.login', () => {
  const login = { email: dto.email, password: dto.password };

  it('returns a token for the right password', async () => {
    const { service, user, jwt } = setup();
    user.findUnique.mockResolvedValue({ id: 'u1', email: dto.email, passwordHash: bcrypt.hashSync(dto.password, 4) });

    await expect(service.login(login)).resolves.toEqual({ accessToken: 'token' });
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: 'u1', email: dto.email });
  });

  it('issues no token for a wrong password', async () => {
    const { service, user, jwt } = setup();
    user.findUnique.mockResolvedValue({ id: 'u1', email: dto.email, passwordHash: bcrypt.hashSync('other-password', 4) });

    await expect(service.login(login)).rejects.toThrow(UnauthorizedException);
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });
});

describe('AuthService.loginWithGoogle', () => {
  const google = { email: dto.email, googleId: 'g1', name: 'Student' };

  it('signs an existing user in without creating another account', async () => {
    const { service, user, jwt } = setup();
    user.findUnique.mockResolvedValue({ id: 'u1', email: dto.email });

    await expect(service.loginWithGoogle(google)).resolves.toEqual({ accessToken: 'token' });
    expect(user.create).not.toHaveBeenCalled();
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: 'u1', email: dto.email });
  });

  it('creates a first-time user under their Google name', async () => {
    const { service, user, jwt } = setup();
    user.findUnique.mockResolvedValue(null);
    user.create.mockResolvedValue({ id: 'u2', email: dto.email });

    await expect(service.loginWithGoogle(google)).resolves.toEqual({ accessToken: 'token' });
    expect(user.create).toHaveBeenCalledWith({
      data: { email: dto.email, googleId: 'g1', name: 'Student' },
    });
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: 'u2', email: dto.email });
  });
});

describe('AuthService.getProfile', () => {
  it('returns the account fields the app shows, name included', async () => {
    const { service, user } = setup();
    user.findUnique.mockResolvedValue({ id: 'u1', email: dto.email, name: 'Student', flavorTextEnabled: true });

    await expect(service.getProfile('u1')).resolves.toEqual({
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

    await expect(service.getProfile('gone')).rejects.toThrow(UnauthorizedException);
  });
});
