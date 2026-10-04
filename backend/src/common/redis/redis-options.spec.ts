import { bullConnectionFromUrl } from './redis-options';

describe('bullConnectionFromUrl', () => {
  it('falls back to a local Redis when there is no url', () => {
    expect(bullConnectionFromUrl(undefined)).toEqual({
      host: 'localhost',
      port: 6379,
    });
  });

  it('reads host, port, user and password from a redis:// url', () => {
    expect(
      bullConnectionFromUrl(
        'redis://default:s3cr%40t@redis-1234.example.com:16379',
      ),
    ).toEqual({
      host: 'redis-1234.example.com',
      port: 16379,
      username: 'default',
      password: 's3cr@t',
      db: undefined,
    });
  });

  it('uses the default port and a database number when given', () => {
    expect(bullConnectionFromUrl('redis://cache.internal/2')).toMatchObject({
      host: 'cache.internal',
      port: 6379,
      db: 2,
    });
  });

  it('turns on TLS for rediss://', () => {
    expect(
      bullConnectionFromUrl('rediss://default:pw@secure.example.com:6380'),
    ).toMatchObject({ tls: {}, port: 6380 });
    expect(
      bullConnectionFromUrl('redis://default:pw@plain.example.com:6380'),
    ).not.toHaveProperty('tls');
  });
});
