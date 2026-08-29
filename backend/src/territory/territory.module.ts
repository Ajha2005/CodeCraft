import { Module } from '@nestjs/common';
import { TerritoryController } from './territory.controller';
import { TerritoryService } from './territory.service';
import { TerritoryGateway } from './territory.gateway';

@Module({
  controllers: [TerritoryController],
  providers: [TerritoryService, TerritoryGateway],
  exports: [TerritoryGateway],
})
export class TerritoryModule {}
