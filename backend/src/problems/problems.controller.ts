import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ProblemsService } from './problems.service';
import { QueryProblemsDto } from './dto/query-problems.dto';

@Controller('problems')
export class ProblemsController {
  constructor(private readonly problemsService: ProblemsService) {}

  @Get()
  findAll(@Query() query: QueryProblemsDto) {
    return this.problemsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.problemsService.findOne(id);
  }
}