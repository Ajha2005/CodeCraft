import { JudgeService } from './judge.service';

// Piston's answer for one program: `compile` only for compiled languages, `run` always.
const run = (over: Record<string, unknown> = {}) => ({
  stdout: '3\n',
  stderr: '',
  code: 0,
  signal: null,
  ...over,
});

function verdictFor(piston: unknown, language = 'c++') {
  const service = new JudgeService({} as never, {} as never);
  jest.spyOn(service, 'runCode').mockResolvedValue(piston as never);
  return service.runSingleTestCase('code', { a: 1, b: 2 }, 3, language, {
    a: 'int',
    b: 'int',
  });
}

describe('JudgeService.runSingleTestCase verdicts', () => {
  it('a compile step that fails is a compile error', async () => {
    const result = await verdictFor({
      compile: { stdout: '', stderr: 'error: expected ;', code: 1, signal: null },
      run: { stdout: '', stderr: '', code: undefined, signal: undefined },
    });
    expect(result).toMatchObject({ status: 'CE', passed: false, stderr: 'error: expected ;' });
  });

  it('a compile step killed by a limit is a compile error', async () => {
    const result = await verdictFor({
      compile: { stdout: '', stderr: '', code: null, signal: 'SIGKILL' },
      run: { stdout: '', stderr: '' },
    });
    expect(result.status).toBe('CE');
  });

  it('compiler warnings alone are not a compile error: the program is judged', async () => {
    const warning = 'main.cpp:9:1: warning: no return statement in function returning non-void';
    const right = await verdictFor({
      compile: { stdout: '', stderr: warning, code: 0, signal: null },
      run: run(),
    });
    expect(right).toMatchObject({ status: 'AC', passed: true });
    const wrong = await verdictFor({
      compile: { stdout: '', stderr: warning, code: 0, signal: null },
      run: run({ stdout: '4\n' }),
    });
    expect(wrong.status).toBe('WA');
  });

  it('judges an interpreted program on its run: AC, WA, RE and TLE', async () => {
    expect((await verdictFor({ run: run() }, 'python')).status).toBe('AC');
    expect((await verdictFor({ run: run({ stdout: '4\n' }) }, 'python')).status).toBe('WA');
    expect((await verdictFor({ run: run({ stdout: '', stderr: 'Traceback', code: 1 }) }, 'python')).status).toBe('RE');
    expect((await verdictFor({ run: run({ stdout: '', signal: 'SIGKILL' }) }, 'python')).status).toBe('TLE');
  });
});
