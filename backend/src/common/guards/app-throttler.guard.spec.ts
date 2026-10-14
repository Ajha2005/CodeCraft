import { AppThrottlerGuard } from './app-throttler.guard';

// getTracker is protected and does not use the guard's state: call it directly.
const tracker = (req: Record<string, unknown>) =>
  (
    AppThrottlerGuard.prototype as unknown as {
      getTracker(req: Record<string, unknown>): Promise<string>;
    }
  ).getTracker(req);

describe('AppThrottlerGuard', () => {
  it('counts an account per account, so a campus behind one address does not share a budget', async () => {
    const a = await tracker({
      ip: '10.0.0.1',
      user: { userId: 'u1', isGuest: false },
    });
    const b = await tracker({
      ip: '10.0.0.1',
      user: { userId: 'u2', isGuest: false },
    });
    const moved = await tracker({
      ip: '10.9.9.9',
      user: { userId: 'u1', isGuest: false },
    });
    expect(a).not.toEqual(b);
    expect(a).toEqual(moved);
  });

  it('counts demo sessions per address, never per token, because anyone can mint more tokens', async () => {
    const first = await tracker({
      ip: '10.0.0.1',
      user: { userId: 'guest:1', isGuest: true },
    });
    const second = await tracker({
      ip: '10.0.0.1',
      user: { userId: 'guest:2', isGuest: true },
    });
    const elsewhere = await tracker({
      ip: '10.0.0.2',
      user: { userId: 'guest:1', isGuest: true },
    });
    expect(first).toEqual(second);
    expect(first).not.toEqual(elsewhere);
  });

  it('counts a caller with no token per address', async () => {
    expect(await tracker({ ip: '10.0.0.1' })).toEqual(
      await tracker({
        ip: '10.0.0.1',
        user: { userId: 'guest:1', isGuest: true },
      }),
    );
  });

  it('never lets an account and an address share a key', async () => {
    expect(await tracker({ ip: 'u1' })).not.toEqual(
      await tracker({ ip: '10.0.0.1', user: { userId: 'u1', isGuest: false } }),
    );
  });
});
