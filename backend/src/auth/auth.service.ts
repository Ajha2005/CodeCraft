import { Injectable, ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AccessTokenPayload, AuthUser, GUEST_PREFIX, GUEST_TOKEN_TTL_SECONDS } from './auth-user';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async signup(dto: SignupDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('Email already registered');
    }
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        name: dto.name,
      },
    });
    return this.signToken(user.id, user.email);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.signToken(user.id, user.email);
  }

  async loginWithGoogle(googleUser: { email: string; googleId: string; name: string }) {
    let user = await this.prisma.user.findUnique({
      where: { email: googleUser.email },
    });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email: googleUser.email,
          googleId: googleUser.googleId,
          name: googleUser.name,
        },
      });
    }

    return this.signToken(user.id, user.email);
  }

  async signToken(userId: string, email: string) {
    const payload = { sub: userId, email };
    const accessToken = await this.jwtService.signAsync(payload);
    return { accessToken };
  }

  /** A demo session: no account, no database row, two hours, read-only (see GuestPolicyGuard). */
  async issueGuestToken() {
    const payload: AccessTokenPayload = { sub: `${GUEST_PREFIX}${randomUUID()}`, role: 'GUEST' };
    const accessToken = await this.jwtService.signAsync(payload, { expiresIn: GUEST_TOKEN_TTL_SECONDS });
    return { accessToken, role: 'GUEST' as const, expiresIn: GUEST_TOKEN_TTL_SECONDS };
  }

  async getProfile(caller: AuthUser) {
    if (caller.isGuest) {
      // No account stands behind a demo session: nothing to look up, nothing personal to show.
      return { userId: caller.userId, email: '', name: 'Demo visitor', isGuest: true, flavorTextEnabled: true };
    }
    const user = await this.prisma.user.findUnique({
      where: { id: caller.userId },
      select: { id: true, email: true, name: true, flavorTextEnabled: true },
    });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    return {
      userId: user.id,
      email: user.email,
      name: user.name,
      flavorTextEnabled: user.flavorTextEnabled,
    };
  }

  async updateSettings(userId: string, flavorTextEnabled: boolean) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { flavorTextEnabled },
      select: { flavorTextEnabled: true },
    });
    return user;
  }
}