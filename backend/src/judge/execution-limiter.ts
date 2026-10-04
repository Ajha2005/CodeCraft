import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

/**
 * Who is asking the code runner to execute something. Lower number wins when
 * a slot frees up: graded submissions first, then "Run" clicks from signed-in
 * users, then demo (guest) runs.
 */
export type RunPriority = 'submission' | 'user' | 'guest';

const ORDER: RunPriority[] = ['submission', 'user', 'guest'];

interface Waiter {
  priority: RunPriority;
  started: boolean;
  start: () => void;
  timer?: NodeJS.Timeout;
}

function intFromEnv(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= min && value <= max
    ? value
    : fallback;
}

const busy = () =>
  new HttpException(
    'The code runner is busy right now. Please try again in a few seconds.',
    HttpStatus.SERVICE_UNAVAILABLE,
  );

/**
 * Caps how many programs run on the (1 GB) box at once, however many requests
 * and queue workers want to run code. One process-wide limiter: the backend
 * runs as a single instance (see deploy/pm2), so in-memory is exact.
 *  - at most `capacity` executions at a time (PISTON_MAX_CONCURRENCY, default 2);
 *  - demo (guest) runs may hold at most one of those slots;
 *  - when a slot frees, graded submissions go first and guests last, so a
 *    flood of demo runs can delay a student's submission by one run, never more;
 *  - interactive callers (not the grading worker) do not queue without limit:
 *    past `maxWaiting` they get a quick 503 instead of a long hang.
 */
@Injectable()
export class ExecutionLimiter {
  private readonly capacity = intFromEnv('PISTON_MAX_CONCURRENCY', 2, 1, 8);
  private readonly guestCapacity = 1;
  private readonly maxWaiting = intFromEnv('RUN_MAX_QUEUE', 20, 1, 500);
  private readonly maxWaitMs = intFromEnv(
    'RUN_MAX_WAIT_MS',
    30_000,
    1000,
    300_000,
  );

  private active = 0;
  private activeGuests = 0;
  private readonly waiting: Record<RunPriority, Waiter[]> = {
    submission: [],
    user: [],
    guest: [],
  };

  stats() {
    const queued = ORDER.reduce(
      (sum, key) => sum + this.waiting[key].length,
      0,
    );
    return {
      active: this.active,
      activeGuests: this.activeGuests,
      queued,
      capacity: this.capacity,
    };
  }

  async run<T>(priority: RunPriority, work: () => Promise<T>): Promise<T> {
    await this.acquire(priority);
    try {
      return await work();
    } finally {
      this.release(priority);
    }
  }

  private canStart(priority: RunPriority): boolean {
    if (this.active >= this.capacity) return false;
    return priority !== 'guest' || this.activeGuests < this.guestCapacity;
  }

  private take(priority: RunPriority): void {
    this.active += 1;
    if (priority === 'guest') this.activeGuests += 1;
  }

  private acquire(priority: RunPriority): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        priority,
        started: false,
        start: () => {
          waiter.started = true;
          if (waiter.timer) clearTimeout(waiter.timer);
          this.take(priority);
          resolve();
        },
      };
      this.waiting[priority].push(waiter);
      this.dispatch(); // starts this waiter at once if a slot is free for it (and anyone else who can go)
      if (waiter.started || priority === 'submission') return;

      const leave = () => {
        const queue = this.waiting[priority];
        const index = queue.indexOf(waiter);
        if (index >= 0) queue.splice(index, 1);
      };
      if (
        this.waiting.user.length + this.waiting.guest.length >
        this.maxWaiting
      ) {
        leave();
        reject(busy());
        return;
      }
      waiter.timer = setTimeout(() => {
        leave();
        reject(busy());
      }, this.maxWaitMs);
      waiter.timer.unref();
    });
  }

  private release(priority: RunPriority): void {
    this.active -= 1;
    if (priority === 'guest') this.activeGuests -= 1;
    this.dispatch();
  }

  private dispatch(): void {
    let started = true;
    while (started) {
      started = false;
      for (const key of ORDER) {
        const next = this.waiting[key][0];
        if (next && this.canStart(key)) {
          this.waiting[key].shift();
          next.start();
          started = true;
          break; // re-evaluate from the highest priority after every start
        }
      }
    }
  }
}
