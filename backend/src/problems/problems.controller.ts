import { Controller, Get, Param, ParseIntPipe, Query, UnauthorizedException } from '@nestjs/common';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';
import { ProblemsService } from './problems.service';
import { QueryProblemsDto } from './dto/query-problems.dto';

@Controller('problems')
export class ProblemsController {
  constructor(private readonly problemsService: ProblemsService) {}

  // Public only for the login page's "how many problems" counter: without a
  // token a caller may ask for a page of one item, and nothing more.
  @Public()
  @Get()
  findAll(@Query() query: QueryProblemsDto, @CurrentUser() user?: AuthUser) {
    if (!user && (query.limit ?? 20) > 1) throw new UnauthorizedException();
    return this.problemsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.problemsService.findOne(id);
  }
}
