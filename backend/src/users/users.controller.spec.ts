import type { AuthUser } from '../auth/auth-user';
import { UsersController } from './users.controller';
import type { UsersService } from './users.service';

describe('UsersController', () => {
  it('hands the username in the link, and who is looking, to the service', async () => {
    const profile = { username: 'arjun_m' };
    const service = { getPublicProfile: jest.fn().mockResolvedValue(profile) };
    const controller = new UsersController(service as unknown as UsersService);
    const viewer: AuthUser = { userId: 'u9', role: 'USER', isGuest: false };

    await expect(controller.getPublicProfile('Arjun_M', viewer)).resolves.toBe(profile);
    expect(service.getPublicProfile).toHaveBeenCalledWith('Arjun_M', viewer);
  });
});
