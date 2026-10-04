import { ForbiddenException, Injectable, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { passwordLoginEnabled } from '../config/env';
import { AuditLogService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { AccessTokenPayload, AuthUser, GUEST_PREFIX } from './auth-user';
import { LoginDto } from './dto/login.dto';
import { normalizeEmail } from './email.util';
import { GUEST_TOKEN_TTL_SECONDS } from './jwt.config';
import { LoginCodeService } from './login-code.service';
import { randomUsername } from './username.util';

/** Cost of new password hashes. Existing (cost 10) hashes are upgraded the next time their owner signs in. */
export const BCRYPT_COST = 12;

// A real bcrypt hash (cost 12) of random data nobody knows. Comparing against it
// when an address is unknown makes that answer take as long as a wrong
// password, so the response time does not reveal which addresses have accounts.
const DUMMY_HASH = '$2b$12$OVuVhixldv1n0wN3Bs23COJOPoEKstG8aagfI87kl/8hfUSEe2DfC';

// Prisma reports a violated unique index as error code P2002.
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002';
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly audit: AuditLogService,
    private readonly loginCodes: LoginCodeService,
  ) {}

  /** A demo session: no account, no database row, two hours, read-only (see AccessGuard). */
  async issueGuestToken() {
    const payload: AccessTokenPayload = { sub: `${GUEST_PREFIX}${randomUUID()}`, role: 'GUEST' };
    const accessToken = await this.jwtService.signAsync(payload, { expiresIn: GUEST_TOKEN_TTL_SECONDS });
    return { accessToken, role: payload.role, expiresIn: GUEST_TOKEN_TTL_SECONDS };
  }

  /** Email + password sign-in. Off unless PASSWORD_LOGIN_ENABLED=true: new accounts come from Google only. */
  async login(dto: LoginDto) {
    if (!passwordLoginEnabled()) {
      throw new ForbiddenException('Password sign-in is turned off. Use "Continue with Google" with your Thapar account.');
    }
    const email = normalizeEmail(dto.email);
    const user = email
      ? await this.prisma.user.findFirst({
          where: { email: { equals: email, mode: 'insensitive' } },
          orderBy: { createdAt: 'asc' },
        })
      : null;

    // Always do exactly one bcrypt comparison, whether or not the address exists.
    const valid = await bcrypt.compare(dto.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !user.passwordHash || !valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (bcrypt.getRounds(user.passwordHash) < BCRYPT_COST) {
      const upgraded = await bcrypt.hash(dto.password, BCRYPT_COST);
      await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: upgraded } });
    }
    return this.signToken(user.id);
  }

  /**
   * Finds or creates the account for a Google identity that already passed the
   * @thapar.edu check, and returns its id. Signing in with Google proves the
   * person controls the mailbox, which a password sign-up never did, so:
   *  - an existing account with the same address is linked to this Google
   *    identity and any password on it is wiped (otherwise whoever registered
   *    the address first, without owning it, would keep a way in);
   *  - an account already linked to a different Google identity is refused.
   */
  async findOrCreateGoogleUser(googleUser: { email: string; googleId: string }, ip?: string): Promise<string> {
    const email = normalizeEmail(googleUser.email);
    if (!email) throw new UnauthorizedException('Only @thapar.edu accounts can sign in');

    const linked = await this.prisma.user.findUnique({ where: { googleId: googleUser.googleId }, select: { id: true } });
    if (linked) return linked.id;

    const sameAddress = await this.prisma.user.findMany({
      where: { email: { equals: email, mode: 'insensitive' } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, googleId: true, passwordHash: true },
    });
    const existing = sameAddress[0];

    if (existing) {
      if (existing.googleId && existing.googleId !== googleUser.googleId) {
        throw new UnauthorizedException('This address is already linked to a different Google account');
      }
      await this.prisma.user.update({ where: { id: existing.id }, data: { googleId: googleUser.googleId, passwordHash: null } });
      await this.audit.record({
        action: 'auth.google_link',
        actorType: 'USER',
        actorId: existing.id,
        targetType: 'user',
        targetId: existing.id,
        reason: 'Google sign-in proved control of the mailbox of an existing account',
        metadata: { passwordCleared: existing.passwordHash !== null },
        ip,
      });
      return existing.id;
    }

    try {
      const created = await this.prisma.user.create({
        data: { email, googleId: googleUser.googleId, username: await this.generateUsername() },
        select: { id: true },
      });
      await this.audit.record({ action: 'auth.account_created', actorType: 'USER', actorId: created.id, targetType: 'user', targetId: created.id, ip });
      return created.id;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // Two first-time sign-ins raced; the other one won. Use its account.
      const winner = await this.prisma.user.findFirst({
        where: { OR: [{ googleId: googleUser.googleId }, { email }] },
        select: { id: true },
      });
      if (!winner) throw err;
      return winner.id;
    }
  }

  /** Trades a one-time code from the Google redirect for an access token. */
  async exchangeLoginCode(code: string) {
    const userId = await this.loginCodes.redeem(code);
    if (!userId) throw new UnauthorizedException('This sign-in link has expired. Please try again.');
    const exists = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!exists) throw new UnauthorizedException('This sign-in link has expired. Please try again.');
    return this.signToken(userId);
  }

  issueLoginCode(userId: string): Promise<string> {
    return this.loginCodes.issue(userId);
  }

  // An unused default username. The unique index is the real guard; this
  // just avoids handing out one that is already taken.
  private async generateUsername(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = randomUsername();
      const taken = await this.prisma.user.findUnique({ where: { username: candidate }, select: { id: true } });
      if (!taken) return candidate;
    }
    throw new InternalServerErrorException('Could not generate a username, please try again');
  }

  /** The token carries who (sub) and what kind (role) and nothing else: no email, no name. */
  async signToken(userId: string) {
    const payload: AccessTokenPayload = { sub: userId, role: 'USER' };
    const accessToken = await this.jwtService.signAsync(payload);
    return { accessToken, role: payload.role };
  }

  async getProfile(user: AuthUser) {
    if (user.isGuest) {
      return { userId: user.userId, username: 'guest', role: user.role, isGuest: true, flavorTextEnabled: true };
    }
    const row = await this.prisma.user.findUnique({
      where: { id: user.userId },
      select: { id: true, username: true, flavorTextEnabled: true },
    });
    if (!row) throw new UnauthorizedException();
    return { userId: row.id, username: row.username, role: user.role, isGuest: false, flavorTextEnabled: row.flavorTextEnabled };
  }

  async updateSettings(userId: string, flavorTextEnabled: boolean) {
    return this.prisma.user.update({ where: { id: userId }, data: { flavorTextEnabled }, select: { flavorTextEnabled: true } });
  }
}
