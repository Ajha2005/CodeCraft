import { Test, TestingModule } from '@nestjs/testing';
import { JudgeService } from '../judge/judge.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProblemsService } from './problems.service';

describe('ProblemsService', () => {
  let service: ProblemsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProblemsService,
        { provide: PrismaService, useValue: {} },
        { provide: JudgeService, useValue: {} },
      ],
    }).compile();

    service = module.get<ProblemsService>(ProblemsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
