import { createHash } from 'crypto';
import { LoginCodeService } from './login-code.service';

/** Just enough Redis for set / multi(get, del) / exec, with expiry bookkeeping. */
function fakeRedis() {
  const store = new Map<string, { value: string; ttl: number }>();
  return {
    store,
    set: jest.fn(async (key: string, value: string, _ex: string, ttl: number) => {
      store.set(key, { value, ttl });
      return 'OK';
    }),
    multi: () => {
      const ops: string[] = [];
      const chain = {
        get(key: string) { ops.push(`get:${key}`); return chain; },
        del(key: string) { ops.push(`del:${key}`); return chain; },
        async exec() {
          const results: [null, unknown][] = [];
          for (const op of ops) {
            const [name, key] = [op.slice(0, 3), op.slice(4)];
            if (name === 'get') results.push([null, store.get(key)?.value ?? null]);
            else results.push([null, store.delete(key) ? 1 : 0]);
          }
          return results;
        },
      };
      return chain;
    },
  };
}

describe('LoginCodeService', () => {
  it('issues a code that works once and then never again', async () => {
    const service = new LoginCodeService(fakeRedis() as never);
    const code = await service.issue('user-1');
    await expect(service.redeem(code)).resolves.toBe('user-1');
    await expect(service.redeem(code)).resolves.toBeNull();
  });

  it('keeps only a hash in Redis, with a 60 second expiry', async () => {
    const redis = fakeRedis();
    const service = new LoginCodeService(redis as never);
    const code = await service.issue('user-1');
    const expectedKey = `auth:code:${createHash('sha256').update(code).digest('hex')}`;
    expect([...redis.store.keys()]).toEqual([expectedKey]);
    expect(redis.store.get(expectedKey)?.ttl).toBe(60);
    expect(JSON.stringify([...redis.store.entries()])).not.toContain(code);
  });

  it('issues unpredictable codes', async () => {
    const service = new LoginCodeService(fakeRedis() as never);
    const codes = new Set(await Promise.all(Array.from({ length: 50 }, () => service.issue('u'))));
    expect(codes.size).toBe(50);
    for (const code of codes) expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it.each(['', 'short', 'x'.repeat(43) + '!', 'x'.repeat(44), '../etc/passwd'])('does not even look up a malformed code (%j)', async (bad) => {
    const redis = fakeRedis();
    const service = new LoginCodeService(redis as never);
    const multi = jest.spyOn(redis, 'multi');
    await expect(service.redeem(bad)).resolves.toBeNull();
    expect(multi).not.toHaveBeenCalled();
  });

  it('does not accept a well-formed code nobody issued', async () => {
    const service = new LoginCodeService(fakeRedis() as never);
    await expect(service.redeem('A'.repeat(43))).resolves.toBeNull();
  });
});
