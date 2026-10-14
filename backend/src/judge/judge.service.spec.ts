import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { Observable, of, throwError } from 'rxjs';
import { ExecutionLimiter } from './execution-limiter';
import { JudgeService } from './judge.service';

const ENV = [
  'PISTON_URL',
  'JUDGE_RUN_TIMEOUT_MS',
  'JUDGE_COMPILE_TIMEOUT_MS',
  'JUDGE_RUN_CPU_MS',
  'JUDGE_COMPILE_CPU_MS',
  'JUDGE_RUN_MEMORY_BYTES',
  'JUDGE_COMPILE_MEMORY_BYTES',
];

const done = {
  data: { run: { stdout: '1', stderr: '', code: 0, signal: null } },
};

function setup(response: unknown = done) {
  const http = {
    post: jest.fn<Observable<unknown>, [string, unknown?, unknown?]>(() =>
      of(response),
    ),
  };
  const limiter = new ExecutionLimiter();
  const run = jest.spyOn(limiter, 'run');
  return { http, run, service: new JudgeService(http as never, limiter) };
}

/** What actually goes over the wire: undefined fields are not sent. */
const wire = (body: unknown) =>
  JSON.parse(JSON.stringify(body)) as Record<string, unknown>;

describe('JudgeService.runCode', () => {
  beforeEach(() => {
    ENV.forEach((name) => delete process.env[name]);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined); // the failure cases below log on purpose
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => ENV.forEach((name) => delete process.env[name]));

  describe('a graded submission', () => {
    it('sends exactly what it always did: no limits of its own, no client timeout', async () => {
      const { http, service } = setup();

      await service.runCode('print(1)', 'python', '3.10.0');

      const [url, body, config] = http.post.mock.calls[0] as unknown as [
        string,
        unknown,
        unknown,
      ];
      expect(url).toBe('http://localhost:2000/api/v2/execute');
      expect(wire(body)).toEqual({
        language: 'python',
        version: '3.10.0',
        files: [{ content: 'print(1)' }],
      });
      expect(config).toBeUndefined();
    });

    it('goes first in the queue for a slot', async () => {
      const { run, service } = setup();
      await service.runCode('x', 'python', '3.10.0');
      expect(run).toHaveBeenCalledWith('submission', expect.any(Function));
    });

    it('lets the grading worker see the runner failing as it is', async () => {
      const { http, service } = setup();
      const failure = new Error('connect ECONNREFUSED 127.0.0.1:2000');
      http.post.mockReturnValue(throwError(() => failure));
      await expect(service.runCode('x', 'python', '3.10.0')).rejects.toBe(
        failure,
      );
    });
  });

  describe.each(['user', 'guest'] as const)(
    'a run from the page (%s)',
    (priority) => {
      it('carries explicit time and memory caps and a client timeout', async () => {
        const { http, service } = setup();

        await service.runCode('x', 'c++', '10.2.0', priority);

        const [, body, config] = http.post.mock.calls[0] as unknown as [
          string,
          unknown,
          unknown,
        ];
        expect(wire(body)).toEqual({
          language: 'c++',
          version: '10.2.0',
          files: [{ content: 'x' }],
          run_timeout: 3000,
          compile_timeout: 10_000,
          run_cpu_time: 3000,
          compile_cpu_time: 10_000,
          run_memory_limit: 128 * 1024 * 1024,
          compile_memory_limit: 384 * 1024 * 1024,
        });
        expect(config).toEqual({
          timeout: 18_000,
          maxContentLength: 1_000_000,
        });
      });

      it(`waits in the ${priority} queue`, async () => {
        const { run, service } = setup();
        await service.runCode('x', 'python', '3.10.0', priority);
        expect(run).toHaveBeenCalledWith(priority, expect.any(Function));
      });

      it('turns a runner failure into a plain "unavailable", without leaking where the runner is', async () => {
        const { http, service } = setup();
        http.post.mockReturnValue(
          throwError(() => new Error('connect ECONNREFUSED 127.0.0.1:2000')),
        );

        const failure = service.runCode('x', 'python', '3.10.0', priority);

        await expect(failure).rejects.toBeInstanceOf(
          ServiceUnavailableException,
        );
        await expect(failure).rejects.toThrow(
          'The code runner is unavailable right now. Please try again shortly.',
        );
        await expect(failure).rejects.not.toThrow(/ECONNREFUSED|2000/);
      });
    },
  );

  describe('settings from the environment', () => {
    it('apply to graded submissions too, because the operator asked for them', async () => {
      process.env.JUDGE_RUN_MEMORY_BYTES = '50000000';
      const { http, service } = setup();

      await service.runCode('x', 'python', '3.10.0');

      const [, body] = http.post.mock.calls[0] as unknown as [string, unknown];
      expect(wire(body)).toEqual({
        language: 'python',
        version: '3.10.0',
        files: [{ content: 'x' }],
        run_memory_limit: 50_000_000,
      });
    });

    it('replace the defaults of a run from the page', async () => {
      process.env.JUDGE_RUN_TIMEOUT_MS = '1000';
      process.env.JUDGE_COMPILE_TIMEOUT_MS = '2000';
      const { http, service } = setup();

      await service.runCode('x', 'python', '3.10.0', 'guest');

      const [, body, config] = http.post.mock.calls[0] as unknown as [
        string,
        Record<string, unknown>,
        Record<string, unknown>,
      ];
      expect(wire(body)).toMatchObject({
        run_timeout: 1000,
        compile_timeout: 2000,
        run_memory_limit: 128 * 1024 * 1024,
      });
      expect(config.timeout).toBe(8000);
    });

    it.each(['abc', '0', '-5', ''])(
      'ignore a value that is not a positive number (%j)',
      async (value) => {
        process.env.JUDGE_RUN_TIMEOUT_MS = value;
        const { http, service } = setup();
        await service.runCode('x', 'python', '3.10.0', 'user');
        expect(wire(http.post.mock.calls[0][1])).toMatchObject({
          run_timeout: 3000,
        });
      },
    );

    it('can point at a runner elsewhere, with or without a trailing slash', async () => {
      process.env.PISTON_URL = 'http://127.0.0.1:2999/';
      const { http, service } = setup();
      await service.runCode('x', 'python', '3.10.0');
      expect(http.post.mock.calls[0][0]).toBe(
        'http://127.0.0.1:2999/api/v2/execute',
      );
    });
  });
});

describe('JudgeService.runSingleTestCase', () => {
  beforeEach(() => ENV.forEach((name) => delete process.env[name]));

  it('passes who is asking on to the queue, and defaults to a graded submission', async () => {
    const guest = setup();
    await guest.service.runSingleTestCase(
      'def f(a): return a',
      { a: 1 },
      1,
      'python',
      { a: 'int' },
      'guest',
    );
    expect(guest.run).toHaveBeenCalledWith('guest', expect.any(Function));

    const graded = setup();
    await graded.service.runSingleTestCase(
      'def f(a): return a',
      { a: 1 },
      1,
      'python',
      { a: 'int' },
    );
    expect(graded.run).toHaveBeenCalledWith('submission', expect.any(Function));
  });

  it('still judges the output as before', async () => {
    const { service } = setup();
    await expect(
      service.runSingleTestCase(
        'def f(a): return a',
        { a: 1 },
        1,
        'python',
        { a: 'int' },
        'user',
      ),
    ).resolves.toMatchObject({
      passed: true,
      status: 'AC',
      actualOutput: '1',
    });
  });
});
