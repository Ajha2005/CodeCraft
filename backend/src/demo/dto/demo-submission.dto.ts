import { IsIn, IsInt, IsOptional, IsPositive, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { MAX_CODE_LENGTH, SUBMISSION_LANGUAGES } from '../../submissions/dto/create-submission.dto';

export class DemoSubmissionDto {
  @IsInt()
  @IsPositive()
  problemId!: number;

  @IsIn(SUBMISSION_LANGUAGES)
  language!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(MAX_CODE_LENGTH)
  code!: string;

  /**
   * Which try this is for the problem. Demo players have no account to count
   * attempts against, so the browser counts and the score's retry penalty uses
   * it. Nothing depends on it being honest: a demo score is never ranked.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  attempts?: number;
}
