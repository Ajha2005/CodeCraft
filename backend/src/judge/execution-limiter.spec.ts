import { HttpException } from '@nestjs/common';
import { ExecutionLimiter } from './execution-limiter';

/** A job that stays "running" until the test lets it finish. */
function controlled() {
  let finish!: () => void;
  const done = new Promise<void>((resolve) => (finish = resolve));
  const started = jest.fn();
  return {
    finish,
    started,
    work: async () => {
      started();
      await done;
      return 'ok';
    },
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('ExecutionLimiter', () => {
  beforeEach(() => {
    process.env.PISTON_MAX_CONCURRENCY = '2';
    process.env.RUN_MAX_QUEUE = '2';
  });
  afterEach(() => {
    delete process.env.PISTON_MAX_CONCURRENCY;
    delete process.env.RUN_MAX_QUEUE;
  });

  it('runs at most `capacity` jobs at once and starts the next when one finishes', async () => {
    const limiter = new ExecutionLimiter();
    const jobs = [controlled(), controlled(), controlled()];
    const promises = jobs.map((job) => limiter.run('user', job.work));
    await tick();
    expect(jobs.map((j) => j.started.mock.calls.length)).toEqual([1, 1, 0]);

    jobs[0].finish();
    await tick();
    expect(jobs[2].started).toHaveBeenCalled();
    jobs[1].finish();
    jobs[2].finish();
    await expect(Promise.all(promises)).resolves.toEqual(['ok', 'ok', 'ok']);
    expect(limiter.stats().active).toBe(0);
  });

  it('lets demo (guest) runs hold only one slot, even when more are free', async () => {
    const limiter = new ExecutionLimiter();
    const [g1, g2] = [controlled(), controlled()];
    const p1 = limiter.run('guest', g1.work);
    const p2 = limiter.run('guest', g2.work);
    await tick();
    expect(g1.started).toHaveBeenCalled();
    expect(g2.started).not.toHaveBeenCalled(); // waits, although a slot is free

    const real = controlled();
    const p3 = limiter.run('user', real.work);
    await tick();
    expect(real.started).toHaveBeenCalled(); // the free slot went to a signed-in user

    g1.finish();
    await tick();
    expect(g2.started).toHaveBeenCalled();
    g2.finish();
    real.finish();
    await Promise.all([p1, p2, p3]);
  });

  it('serves graded submissions before runs, and runs before demo runs', async () => {
    const limiter = new ExecutionLimiter();
    const order: string[] = [];
    const blockers = [controlled(), controlled()];
    const running = blockers.map((b) => limiter.run('user', b.work));
    await tick();

    const queue = (priority: 'guest' | 'user' | 'submission') =>
      limiter.run(priority, async () => {
        order.push(priority);
      });
    const waiting = [queue('guest'), queue('user'), queue('submission')];
    blockers[0].finish();
    blockers[1].finish();
    await Promise.all([...running, ...waiting]);
    expect(order).toEqual(['submission', 'user', 'guest']);
  });

  it('answers 503 quickly instead of queueing interactive runs without limit', async () => {
    const limiter = new ExecutionLimiter();
    const blockers = [controlled(), controlled()];
    const running = blockers.map((b) => limiter.run('user', b.work));
    await tick();
    const waiting = [
      limiter.run('user', async () => 1),
      limiter.run('user', async () => 2),
    ];

    await expect(limiter.run('user', async () => 3)).rejects.toMatchObject({
      status: 503,
    });
    await expect(limiter.run('guest', async () => 4)).rejects.toBeInstanceOf(
      HttpException,
    );

    blockers.forEach((b) => b.finish());
    await Promise.all([...running, ...waiting]);
  });

  it('never refuses the grading worker, however long the queue', async () => {
    const limiter = new ExecutionLimiter();
    const blockers = [controlled(), controlled()];
    const running = blockers.map((b) => limiter.run('user', b.work));
    await tick();
    const graded = Array.from({ length: 10 }, (_, i) =>
      limiter.run('submission', async () => i),
    );
    blockers.forEach((b) => b.finish());
    await expect(Promise.all(graded)).resolves.toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    await Promise.all(running);
  });

  it('frees the slot when the job throws', async () => {
    const limiter = new ExecutionLimiter();
    await expect(
      limiter.run('user', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(limiter.stats().active).toBe(0);
  });
});
