import type { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy.validate', () => {
  const strategy = new JwtStrategy({ get: () => 'test-secret' } as unknown as ConfigService);

  it('exposes the username from the token', async () => {
    await expect(strategy.validate({ sub: 'u1', email: 'a@thapar.edu', username: 'arjun_m' })).resolves.toEqual({
      userId: 'u1',
      email: 'a@thapar.edu',
      username: 'arjun_m',
    });
  });

  it('still accepts a token issued before usernames existed', async () => {
    await expect(strategy.validate({ sub: 'u1', email: 'a@thapar.edu' })).resolves.toEqual({
      userId: 'u1',
      email: 'a@thapar.edu',
    });
  });
});
