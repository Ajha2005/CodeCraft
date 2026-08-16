import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QueryProblemsDto } from './dto/query-problems.dto';

@Injectable()
export class ProblemsService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: QueryProblemsDto) {
    const { difficulty, limit = 20, offset = 0 } = query;

    const where = difficulty ? { difficultyLevel: difficulty } : {};

    const [items, total] = await Promise.all([
      this.prisma.problem.findMany({
        where,
        select: {
          id: true,
          title: true,
          difficultyLevel: true,
        },
        skip: offset,
        take: limit,
        orderBy: { id: 'asc' },
      }),
      this.prisma.problem.count({ where }),
    ]);

    return { items, total, limit, offset };
  }

  async findOne(id: number) {
    const problem = await this.prisma.problem.findUnique({
      where: { id },
    });

    if (!problem) {
      throw new NotFoundException(`Problem with id ${id} not found`);
    }

    return problem;
  }
}