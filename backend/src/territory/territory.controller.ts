// backend/src/territory/territory.controller.ts
import { Controller, Get } from '@nestjs/common';
import { TerritoryService } from './territory.service';

@Controller('territories')
export class TerritoryController {
  constructor(private readonly territoryService: TerritoryService) {}

  @Get('cells')
findAllCells() {
  return this.territoryService.findAllCells();
}
  @Get()
  findAll() {
    return this.territoryService.findAll();
  }
  
}