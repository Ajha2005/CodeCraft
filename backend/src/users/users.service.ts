import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { USERNAME_PATTERN } from '../auth/username.util';

/** Everything a public profile shows. Never email, real name, password hash or settings. */
export interface PublicProfileDto {
  userId: string;
  username: string;
  totalScore: number;
  cellsHeld: number;
  territoriesHeld: number;
  problemsSolved: number;
  joinedAt: Date;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getPublicProfile(rawUsername: string): Promise<PublicProfileDto> {
    // Usernames are stored lowercase, so an exact lowercase match is a
    // case-insensitive lookup. Anything that could never be a username is a
    // 404 without touching the database.
    const username = rawUsername.toLowerCase();
    const user = USERNAME_PATTERN.test(username)
      ? await this.prisma.user.findUnique({
          where: { username },
          select: { id: true, username: true, createdAt: true },
        })
      : null;
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Same definitions as the rest of the app: score is the sum of performance
    // scores, a cell is held while its ownership row is open, a problem is
    // solved once any of its submissions was accepted ('AC').
    const [score, heldCells, solved] = await Promise.all([
      this.prisma.performanceScore.aggregate({
        where: { submission: { userId: user.id } },
        _sum: { totalScore: true },
      }),
      this.prisma.territoryCellOwnership.findMany({
        where: { userId: user.id, closedAt: null },
        select: { cell: { select: { territoryId: true } } },
      }),
      this.prisma.submission.findMany({
        where: { userId: user.id, verdict: 'AC' },
        distinct: ['problemId'],
        select: { problemId: true },
      }),
    ]);

    return {
      userId: user.id,
      username: user.username,
      totalScore: score._sum.totalScore ?? 0,
      cellsHeld: heldCells.length,
      territoriesHeld: new Set(heldCells.map((c) => c.cell.territoryId)).size,
      problemsSolved: solved.length,
      joinedAt: user.createdAt,
    };
  }
}
