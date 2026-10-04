import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { RunService } from './run.service';

const user: AuthUser = { userId: 'u1', role: 'USER', isGuest: false };
const guest: AuthUser = { userId: 'guest:1', role: 'GUEST', isGuest: true };

const problem = {
  examples: [
    { input: { a: 1, b: 2 }, output: 3 },
    { input: { a: 5, b: 5 }, output: 10 },
  ],
  testCases: [
    { input: { a: 1, b: 2 }, expected_output: 3 },
    { input: { a: 99, b: 1 }, expected_output: 100 }, // hidden: must never be run or returned by /run
  ],
};

function setup(row: unknown = problem) {
  // The only table /run may touch is `problem`, read-only. Anything else is undefined and would throw.
  const prisma = { problem: { findUnique: jest.fn().mockResolvedValue(row) } };
  const judge = {
    inferParamTypes: jest.fn().mockReturnValue({ a: 'int', b: 'int' }),
    runSingleTestCase: jest.fn(async (_code: string, input: Record<string, number>, expected: unknown) => {
      const actual = input.a + input.b;
      return { passed: actual === expected, status: actual === expected ? 'AC' : 'WA', input, actualOutput: String(actual), expectedOutput: JSON.stringify(expected), stderr: undefined };
    }),
  };
  return { prisma, judge, service: new RunService(prisma as never, judge as never) };
}

describe('RunService', () => {
  it('runs only the published examples, never the hidden test cases', async () => {
    const { judge, service } = setup();
    const result = await service.runSamples({ problemId: 7, language: 'python', code: 'x' }, user);

    expect(judge.runSingleTestCase).toHaveBeenCalledTimes(2);
    expect(judge.runSingleTestCase.mock.calls.map((c) => c[1])).toEqual([{ a: 1, b: 2 }, { a: 5, b: 5 }]);
    expect(JSON.stringify(result)).not.toContain('100');
    expect(result).toMatchObject({ problemId: 7, passed: 2, total: 2, verdict: 'AC' });
  });

  it('reads the parameter types from the hidden cases (shapes only)', async () => {
    const { judge, service } = setup();
    await service.runSamples({ problemId: 7, language: 'python', code: 'x' }, user);
    expect(judge.inferParamTypes).toHaveBeenCalledWith(problem.testCases);
  });

  it('only reads from the database: one problem lookup, no writes', async () => {
    const { prisma, service } = setup();
    await service.runSamples({ problemId: 7, language: 'c++', code: 'x' }, user);
    expect(prisma.problem.findUnique).toHaveBeenCalledTimes(1);
    expect(Object.keys(prisma)).toEqual(['problem']); // nothing else was available to write to
  });

  it('gives demo sessions the lowest priority and signed-in users the middle one', async () => {
    const asGuest = setup();
    await asGuest.service.runSamples({ problemId: 7, language: 'python', code: 'x' }, guest);
    expect(asGuest.judge.runSingleTestCase.mock.calls[0][5]).toBe('guest');

    const asUser = setup();
    await asUser.service.runSamples({ problemId: 7, language: 'python', code: 'x' }, user);
    expect(asUser.judge.runSingleTestCase.mock.calls[0][5]).toBe('user');
  });

  it('reports the first failing sample as the verdict', async () => {
    const { judge, service } = setup();
    judge.runSingleTestCase.mockImplementationOnce(async (_c, input) => ({ passed: false, status: 'WA', input, actualOutput: '0', expectedOutput: '3', stderr: undefined }));
    const result = await service.runSamples({ problemId: 7, language: 'python', code: 'x' }, user);
    expect(result).toMatchObject({ passed: 1, total: 2, verdict: 'WA' });
    expect(result.results[0]).toMatchObject({ passed: false, status: 'WA', actualOutput: '0' });
  });

  it('stops after a compile error and shows the compiler text', async () => {
    const { judge, service } = setup();
    judge.runSingleTestCase.mockResolvedValue({ passed: false, status: 'CE', input: {}, actualOutput: '', expectedOutput: '3', stderr: 'error: expected ;' } as never);
    const result = await service.runSamples({ problemId: 7, language: 'c++', code: 'x' }, user);
    expect(judge.runSingleTestCase).toHaveBeenCalledTimes(1);
    expect(result.results[0]).toMatchObject({ status: 'CE', error: 'error: expected ;' });
  });

  it('clips very long output', async () => {
    const { judge, service } = setup();
    judge.runSingleTestCase.mockResolvedValue({ passed: false, status: 'WA', input: {}, actualOutput: 'x'.repeat(50_000), expectedOutput: '3', stderr: undefined } as never);
    const result = await service.runSamples({ problemId: 7, language: 'python', code: 'x' }, user);
    expect(result.results[0].actualOutput.length).toBeLessThanOrEqual(4000);
  });

  it('404s for an unknown problem and 422s for one without samples', async () => {
    await expect(setup(null).service.runSamples({ problemId: 1, language: 'python', code: 'x' }, user)).rejects.toBeInstanceOf(NotFoundException);
    await expect(setup({ examples: [], testCases: [] }).service.runSamples({ problemId: 1, language: 'python', code: 'x' }, user)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('ignores malformed example rows instead of crashing', async () => {
    const { judge, service } = setup({ examples: [null, 'x', { input: 'nope', output: 1 }, { input: { a: 1, b: 1 }, output: 2 }], testCases: [] });
    await service.runSamples({ problemId: 7, language: 'python', code: 'x' }, user);
    expect(judge.runSingleTestCase).toHaveBeenCalledTimes(1);
  });
});
