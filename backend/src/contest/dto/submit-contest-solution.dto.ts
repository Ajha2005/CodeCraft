import { IsIn, IsString } from 'class-validator';

export class SubmitContestSolutionDto {
  @IsString()
  code!: string;

  @IsIn(['python', 'c++'])
  language!: string;
}
