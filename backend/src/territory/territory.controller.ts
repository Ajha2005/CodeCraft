import { Controller, Get, Header } from '@nestjs/common';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';
import { TerritoryService } from './territory.service';

@Controller('territories')
export class TerritoryController {
  constructor(private readonly territoryService: TerritoryService) {}

  // The zone list is public (the login page counts the zones); it holds no player data.
  @Public()
  @Get()
  findAll() {
    return this.territoryService.findAll();
  }

  /** Which cells exist. Static between regrids, so a browser may keep it for a few minutes. */
  @Get('grid')
  @Header('Cache-Control', 'private, max-age=300')
  grid() {
    return this.territoryService.grid();
  }

  /** Who holds what, for the caller. Always revalidated (cheap: an unchanged answer is a 304). */
  @Get('owners')
  @Header('Cache-Control', 'private, no-cache')
  owners(@CurrentUser() viewer: AuthUser) {
    return this.territoryService.owners(viewer);
  }
}
