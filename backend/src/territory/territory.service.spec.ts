import { Test, TestingModule } from '@nestjs/testing';
import { TerritoryService } from './territory.service';

describe('TerritoryService', () => {
  let service: TerritoryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TerritoryService],
    }).compile();

    service = module.get<TerritoryService>(TerritoryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
