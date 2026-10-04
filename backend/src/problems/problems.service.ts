import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QueryProblemsDto } from './dto/query-problems.dto';
import { JudgeService } from '../judge/judge.service';
import type { ProblemDetailDto } from './problem.dto';

@Injectable()
export class ProblemsService {
  constructor(
    private prisma: PrismaService,
    private judgeService: JudgeService,
  ) {}

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

  async findOne(id: number): Promise<ProblemDetailDto> {
    const problem = await this.prisma.problem.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        difficultyLevel: true,
        description: true,
        examples: true,
        constraints: true,
        testCases: true, // read only to shape the starter code; never copied into the response below
      },
    });
    if (!problem) {
      throw new NotFoundException(`Problem with id ${id} not found`);
    }
    return {
      id: problem.id,
      title: problem.title,
      difficultyLevel: problem.difficultyLevel,
      description: problem.description,
      examples: problem.examples,
      constraints: problem.constraints,
      boilerplate: this.judgeService.generateBoilerplate(problem.testCases as never),
    };
  }
}
