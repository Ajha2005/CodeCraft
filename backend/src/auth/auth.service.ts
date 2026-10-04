import { Injectable, ConflictException, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { randomUsername } from './username.util';

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
        username: await this.generateUsername(),
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
          username: await this.generateUsername(),
        },
      });
    }

    return this.signToken(user.id, user.email);
  }

  // An unused default username. The unique index is the real guard; this
  // just avoids handing out one that is already taken.
  private async generateUsername(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = randomUsername();
      const taken = await this.prisma.user.findUnique({
        where: { username: candidate },
        select: { id: true },
      });
      if (!taken) return candidate;
    }
    throw new InternalServerErrorException('Could not generate a username, please try again');
  }

  async signToken(userId: string, email: string) {
    const payload = { sub: userId, email };
    const accessToken = await this.jwtService.signAsync(payload);
    return { accessToken };
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
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