import { expireSession, readToken } from '../auth/session';

export const API_BASE: string = import.meta.env.VITE_API_BASE || 'http://localhost:3000';

/** A failed API call. `message` is the server's own wording when it sent one. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
  /** Send the access token (default). Public calls such as the login page's counters turn it off. */
  auth?: boolean;
  /** Passed to fetch: 'reload' skips the browser cache, e.g. for a map grid that turned out to be stale. */
  cache?: RequestCache;
  signal?: AbortSignal;
}

function messageFrom(body: unknown, fallback: string): string {
  const message = (body as { message?: unknown } | null)?.message;
  if (typeof message === 'string' && message.trim()) return message;
  if (Array.isArray(message) && message.length > 0) return message.map(String).join(', ');
  return fallback;
}

/**
 * One way to call the API: adds the token, turns a non-2xx answer into an
 * ApiError, and signs the app out on 401 (an expired or revoked session) so no
 * page is left showing a half-working screen.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true, cache, signal } = options;
  const token = auth ? readToken() : null;
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache,
    signal,
  });

  if (!res.ok) {
    if (res.status === 401 && token) expireSession();
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      // not JSON (a proxy error page, say): the status is all there is
    }
    throw new ApiError(res.status, messageFrom(parsed, `Request failed: ${res.status}`));
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
