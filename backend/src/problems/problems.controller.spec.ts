import { UnauthorizedException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { ProblemsController } from './problems.controller';

describe('ProblemsController', () => {
  const service = { findAll: jest.fn().mockResolvedValue({ items: [], total: 0, limit: 1, offset: 0 }), findOne: jest.fn() };
  const controller = new ProblemsController(service as never);
  const user: AuthUser = { userId: 'u1', role: 'USER', isGuest: false };

  it('lets an anonymous caller read the one-item page the login screen uses', async () => {
    await expect(controller.findAll({ limit: 1 })).resolves.toBeDefined();
  });

  it('refuses an anonymous caller who asks for more than that', () => {
    expect(() => controller.findAll({ limit: 100 })).toThrow(UnauthorizedException);
    expect(() => controller.findAll({})).toThrow(UnauthorizedException); // the default page is 20
  });

  it('serves the full list to a signed-in user', async () => {
    await expect(controller.findAll({ limit: 100 }, user)).resolves.toBeDefined();
  });
});
