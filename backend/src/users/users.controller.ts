import { Controller, Get, Param } from '@nestjs/common';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // Any valid token reads a profile (demo guests included); anonymous callers do not.
  @Get(':username')
  getPublicProfile(@Param('username') username: string, @CurrentUser() viewer: AuthUser) {
    return this.usersService.getPublicProfile(username, viewer);
  }
}
