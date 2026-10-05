import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearToken, expireSession, onSessionExpired, readToken, storeToken, takeSessionEndedNote, tokenExpiresAt } from './session';

/** A minimal Storage, since the tests run in Node. */
function fakeStorage(): Storage {
  const data = new Map<string, string>();
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

/** A token shaped like ours (header.payload.signature). Only the payload is ever read here. */
function tokenWith(payload: object): string {
  const part = (value: object) => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part(payload)}.signature`;
}

beforeEach(() => {
  vi.stubGlobal('localStorage', fakeStorage());
  vi.stubGlobal('sessionStorage', fakeStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the stored token', () => {
  it('is stored, read back and cleared', () => {
    expect(readToken()).toBeNull();
    storeToken('abc');
    expect(readToken()).toBe('abc');
    clearToken();
    expect(readToken()).toBeNull();
  });

  it('survives storage being unavailable', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(() => storeToken('abc')).not.toThrow();
    expect(readToken()).toBeNull();
    expect(() => clearToken()).not.toThrow();
  });
});

describe('tokenExpiresAt', () => {
  it('reads exp from the token and returns milliseconds', () => {
    expect(tokenExpiresAt(tokenWith({ sub: 'x', exp: 1_900_000_000 }))).toBe(1_900_000_000_000);
  });

  it('returns null for anything that is not a token with a numeric exp', () => {
    expect(tokenExpiresAt(null)).toBeNull();
    expect(tokenExpiresAt('')).toBeNull();
    expect(tokenExpiresAt('not-a-token')).toBeNull();
    expect(tokenExpiresAt('a.b.c')).toBeNull();
    expect(tokenExpiresAt(tokenWith({ sub: 'x' }))).toBeNull();
    expect(tokenExpiresAt(tokenWith({ exp: '1900000000' }))).toBeNull();
  });
});

describe('expireSession', () => {
  it('tells listeners once and leaves a note for the login page', () => {
    storeToken('abc');
    const listener = vi.fn();
    const stop = onSessionExpired(listener);

    expireSession();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(takeSessionEndedNote()).toBe(true);
    expect(takeSessionEndedNote()).toBe(false); // read once
    stop();
  });

  it('does nothing when nobody is signed in', () => {
    const listener = vi.fn();
    const stop = onSessionExpired(listener);
    expireSession();
    expect(listener).not.toHaveBeenCalled();
    expect(takeSessionEndedNote()).toBe(false);
    stop();
  });

  it('stops telling a listener that has unsubscribed', () => {
    storeToken('abc');
    const listener = vi.fn();
    onSessionExpired(listener)();
    expireSession();
    expect(listener).not.toHaveBeenCalled();
  });
});
