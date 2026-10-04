import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { MAX_CODE_CHARS, SUPPORTED_LANGUAGES, SupportedLanguage } from '../../common/limits';

export class SubmitContestSolutionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_CODE_CHARS)
  code!: string;

  @IsIn(SUPPORTED_LANGUAGES)
  language!: SupportedLanguage;
}
