import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TerritoryController } from './territory.controller';
import { TerritoryService } from './territory.service';
import { TerritoryGateway } from './territory.gateway';

@Module({
  imports: [AuthModule], // the gateway checks access tokens in the handshake
  controllers: [TerritoryController],
  providers: [TerritoryService, TerritoryGateway],
  exports: [TerritoryGateway, TerritoryService],
})
export class TerritoryModule {}
