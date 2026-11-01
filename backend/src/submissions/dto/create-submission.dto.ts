import { IsIn, IsInt, IsPositive, IsString, MaxLength, MinLength } from 'class-validator';

/** The languages the judge can run (see JudgeService). */
export const SUBMISSION_LANGUAGES = ['python', 'c++'] as const;

/** Source code is capped so one request cannot park a megabyte of text in the queue. */
export const MAX_CODE_LENGTH = 50_000;

export class CreateSubmissionDto {
  @IsInt()
  @IsPositive()
  problemId!: number;

  @IsIn(SUBMISSION_LANGUAGES)
  language!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(MAX_CODE_LENGTH)
  code!: string;
}
