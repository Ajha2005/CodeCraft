import { accessTokenTtl, corsAllowlist, isAllowedOrigin, jwtSecretProblem, listenHost, trustProxyHops, validateEnv } from './env';

const STRONG = 'Zx9!kQ2#vL7@pR4$wN8%cT5^yB1&hG6*mD3(sF0)';
const base = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://u:p@db.example.com:5432/postgres',
  REDIS_URL: 'redis://default:pw@redis.example.com:6379',
  JWT_SECRET: STRONG,
  GOOGLE_CLIENT_ID: 'id',
  GOOGLE_CLIENT_SECRET: 'secret',
  GOOGLE_CALLBACK_URL: 'https://api.example.com/auth/google/callback',
  FRONTEND_URL: 'https://app.example.com',
};

describe('jwtSecretProblem', () => {
  it('accepts a long, varied secret', () => expect(jwtSecretProblem(STRONG)).toBeNull());

  it.each([
    [undefined, 'not set'],
    ['', 'not set'],
    ['short-secret', 'too short'],
    ['dev_secret_change_this_in_production', 'placeholder'],
    ['changeme'.repeat(5), 'variety'],
    ['a'.repeat(40), 'variety'],
  ])('rejects %j', (secret, why) => {
    expect(jwtSecretProblem(secret as string | undefined)).toEqual(expect.stringContaining(why === 'placeholder' ? 'well-known' : why === 'variety' ? 'variety' : why));
  });

  it('never repeats the secret in its message', () => {
    expect(jwtSecretProblem('tooshort123')).not.toContain('tooshort123');
  });
});

describe('validateEnv', () => {
  it('passes with a complete production environment', () => {
    expect(() => validateEnv(base)).not.toThrow();
  });

  it('lists every missing setting at once, without any values', () => {
    let message = '';
    try {
      validateEnv({ NODE_ENV: 'production', JWT_SECRET: 'weak-but-secret-looking' });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('DATABASE_URL is not set');
    expect(message).toContain('REDIS_URL is not set');
    expect(message).toContain('GOOGLE_CLIENT_ID is not set');
    expect(message).toContain('FRONTEND_URL is not set');
    expect(message).toContain('JWT_SECRET is too short');
    expect(message).not.toContain('weak-but-secret-looking');
  });

  it('refuses a localhost frontend in production', () => {
    expect(() => validateEnv({ ...base, FRONTEND_URL: 'http://localhost:5173' })).toThrow(/localhost/);
    expect(() => validateEnv({ ...base, CORS_ORIGINS: 'https://app.example.com,http://127.0.0.1:3000' })).toThrow(/localhost/);
  });

  it('does not need Redis or a frontend URL outside production', () => {
    expect(() =>
      validateEnv({ NODE_ENV: 'development', DATABASE_URL: base.DATABASE_URL, JWT_SECRET: STRONG, GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b', GOOGLE_CALLBACK_URL: 'http://localhost:3000/auth/google/callback' }),
    ).not.toThrow();
  });
});

describe('CORS allowlist', () => {
  it('is exactly the configured origins in production, with no localhost and no wildcard', () => {
    const env = { ...base, CORS_ORIGINS: 'https://demo.example.com/, http://localhost:5173' };
    expect(corsAllowlist(env)).toEqual(['https://app.example.com', 'https://demo.example.com']);
  });

  it('adds the local dev servers outside production', () => {
    expect(corsAllowlist({ NODE_ENV: 'development', FRONTEND_URL: 'https://app.example.com' })).toEqual(
      expect.arrayContaining(['https://app.example.com', 'http://localhost:5173']),
    );
  });

  it('allows non-browser calls (no Origin) and listed origins only', () => {
    expect(isAllowedOrigin(undefined, base)).toBe(true);
    expect(isAllowedOrigin('https://app.example.com', base)).toBe(true);
    expect(isAllowedOrigin('https://app.example.com.evil.com', base)).toBe(false);
    expect(isAllowedOrigin('http://app.example.com', base)).toBe(false);
    expect(isAllowedOrigin('http://localhost:5173', base)).toBe(false);
    expect(isAllowedOrigin('null', base)).toBe(false);
  });
});

describe('network settings', () => {
  it('trusts one proxy hop in production and none in development', () => {
    expect(trustProxyHops({ NODE_ENV: 'production' })).toBe(1);
    expect(trustProxyHops({ NODE_ENV: 'development' })).toBe(0);
    expect(trustProxyHops({ NODE_ENV: 'production', TRUST_PROXY_HOPS: '2' })).toBe(2);
    expect(() => trustProxyHops({ TRUST_PROXY_HOPS: 'many' })).toThrow();
  });

  it('listens on loopback unless told otherwise', () => {
    expect(listenHost({})).toBe('127.0.0.1');
    expect(listenHost({ HOST: '0.0.0.0' })).toBe('0.0.0.0');
  });

  it('defaults access tokens to 12 hours and validates the format', () => {
    expect(accessTokenTtl({})).toBe('12h');
    expect(accessTokenTtl({ JWT_EXPIRES_IN: '30m' })).toBe('30m');
    expect(() => accessTokenTtl({ JWT_EXPIRES_IN: 'forever' })).toThrow();
  });
});
