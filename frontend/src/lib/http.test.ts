import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onSessionExpired } from '../auth/session';
import { ApiError, request } from './http';

function fakeStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value)),
  };
}

const fetchMock = vi.fn<typeof fetch>();

function answer(status: number, body?: unknown) {
  fetchMock.mockResolvedValueOnce(new Response(body === undefined ? null : JSON.stringify(body), { status }));
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('localStorage', fakeStorage({ accessToken: 'tok' }));
  vi.stubGlobal('sessionStorage', fakeStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('request', () => {
  it('sends the access token, and JSON bodies as JSON', async () => {
    answer(200, { ok: true });
    await request('/run', { method: 'POST', body: { code: 'x' } });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/run$/);
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer tok', 'Content-Type': 'application/json' });
    expect(init?.body).toBe('{"code":"x"}');
  });

  it('leaves the token off public calls', async () => {
    answer(200, []);
    await request('/territories', { auth: false });
    expect((fetchMock.mock.calls[0][1]?.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('turns a failure into an ApiError carrying the status and the server\'s own message', async () => {
    answer(400, { statusCode: 400, message: ['code must be shorter than or equal to 20000 characters', 'language is wrong'] });
    await expect(request('/run')).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      message: 'code must be shorter than or equal to 20000 characters, language is wrong',
    });
  });

  it('copes with an error that is not JSON', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>Bad gateway</html>', { status: 502 }));
    const err = await request('/health').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 502, message: 'Request failed: 502' });
  });

  it('signs the session out on 401 when a token was sent', async () => {
    const expired = vi.fn();
    const stop = onSessionExpired(expired);
    answer(401, { message: 'Unauthorized' });
    await expect(request('/auth/me')).rejects.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalledTimes(1);
    stop();
  });

  it('does not treat a 401 on a public call as an expired session', async () => {
    const expired = vi.fn();
    const stop = onSessionExpired(expired);
    answer(401, { message: 'Invalid' });
    await expect(request('/auth/exchange', { method: 'POST', body: { code: 'x' }, auth: false })).rejects.toMatchObject({ status: 401 });
    expect(expired).not.toHaveBeenCalled();
    stop();
  });

  it('passes the cache mode through, so a stale map grid can be refetched', async () => {
    answer(200, {});
    await request('/territories/grid', { cache: 'reload' });
    expect(fetchMock.mock.calls[0][1]?.cache).toBe('reload');
  });

  it('returns nothing for a 204', async () => {
    answer(204);
    await expect(request('/x')).resolves.toBeUndefined();
  });
});
