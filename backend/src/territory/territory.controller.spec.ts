import { Test, TestingModule } from '@nestjs/testing';
import { TerritoryController } from './territory.controller';
import { TerritoryService } from './territory.service';

describe('TerritoryController', () => {
  let controller: TerritoryController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TerritoryController],
      providers: [{ provide: TerritoryService, useValue: {} }],
    }).compile();

    controller = module.get<TerritoryController>(TerritoryController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
