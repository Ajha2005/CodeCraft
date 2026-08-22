import { Test, TestingModule } from '@nestjs/testing';
import { TerritoryController } from './territory.controller';

describe('TerritoryController', () => {
  let controller: TerritoryController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TerritoryController],
    }).compile();

    controller = module.get<TerritoryController>(TerritoryController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
