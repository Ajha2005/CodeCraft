import { GUARDS_METADATA } from '@nestjs/common/constants';
import { UsersController } from './users.controller';
import type { UsersService } from './users.service';

describe('UsersController', () => {
  it('hands the username in the link to the service', async () => {
    const profile = { username: 'arjun_m' };
    const service = { getPublicProfile: jest.fn().mockResolvedValue(profile) };
    const controller = new UsersController(service as unknown as UsersService);

    await expect(controller.getPublicProfile('Arjun_M')).resolves.toBe(profile);
    expect(service.getPublicProfile).toHaveBeenCalledWith('Arjun_M');
  });

  it('is open to everyone, like the leaderboard (no login guard)', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, UsersController)).toBeUndefined();
    expect(Reflect.getMetadata(GUARDS_METADATA, UsersController.prototype.getPublicProfile)).toBeUndefined();
  });
});
