import { IsIn, IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { MAX_CODE_CHARS, SUPPORTED_LANGUAGES, SupportedLanguage } from '../../common/limits';

/** Who is submitting is never in the body: it comes from the access token. */
export class CreateSubmissionDto {
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  problemId!: number;

  @IsIn(SUPPORTED_LANGUAGES)
  language!: SupportedLanguage;

  @IsString()
  @MinLength(1)
  @MaxLength(MAX_CODE_CHARS)
  code!: string;
}
