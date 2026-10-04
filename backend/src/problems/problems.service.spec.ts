import { NotFoundException } from '@nestjs/common';
import { ProblemsService } from './problems.service';

const row = {
  id: 7,
  title: 'Two Sum',
  difficultyLevel: 'Easy',
  description: 'Add them up.',
  examples: [{ input: { a: 1, b: 2 }, output: 3 }],
  constraints: ['1 <= a'],
  testCases: [{ input: { a: 1, b: 2 }, expected_output: 3 }, { input: { a: 40, b: 2 }, expected_output: 42 }],
};

function setup(found: typeof row | null) {
  const prisma = { problem: { findUnique: jest.fn().mockResolvedValue(found), findMany: jest.fn(), count: jest.fn() } };
  const judge = { generateBoilerplate: jest.fn().mockReturnValue({ python: 'def solve(a, b):\n    pass\n' }) };
  return { prisma, judge, service: new ProblemsService(prisma as never, judge as never) };
}

describe('ProblemsService.findOne', () => {
  it('never returns the hidden test cases', async () => {
    const { service } = setup(row);
    const result = await service.findOne(7);
    expect(Object.keys(result).sort()).toEqual(['boilerplate', 'constraints', 'description', 'difficultyLevel', 'examples', 'id', 'title']);
    expect(JSON.stringify(result)).not.toContain('expected_output');
    expect(JSON.stringify(result)).not.toContain('testCases');
  });

  it('builds the starter code from the hidden cases without exposing them', async () => {
    const { service, judge } = setup(row);
    const result = await service.findOne(7);
    expect(judge.generateBoilerplate).toHaveBeenCalledWith(row.testCases);
    expect(result.boilerplate).toEqual({ python: 'def solve(a, b):\n    pass\n' });
  });

  it('answers 404 for an unknown problem', async () => {
    const { service } = setup(null);
    await expect(service.findOne(99)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ProblemsService.findAll', () => {
  it('selects only id, title and difficulty', async () => {
    const { prisma, service } = setup(null);
    prisma.problem.findMany.mockResolvedValue([]);
    prisma.problem.count.mockResolvedValue(0);
    await service.findAll({ limit: 5, offset: 0 });
    expect(prisma.problem.findMany).toHaveBeenCalledWith(expect.objectContaining({ select: { id: true, title: true, difficultyLevel: true } }));
  });
});
