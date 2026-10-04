import {
  IsIn,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  MAX_CODE_CHARS,
  SUPPORTED_LANGUAGES,
  SupportedLanguage,
} from '../common/limits';

export class RunDto {
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

/** One sample case and what the program did with it. Everything here is already public on the problem page. */
export interface RunCaseResult {
  index: number;
  input: unknown;
  expectedOutput: string;
  actualOutput: string;
  /** AC | WA | TLE | RE | CE */
  status: string;
  passed: boolean;
  runtimeMs: number;
  /** Compiler or runtime error text, trimmed. */
  error?: string;
}

export interface RunResult {
  problemId: number;
  language: SupportedLanguage;
  passed: number;
  total: number;
  /** AC when every sample passed, otherwise the first failing case's status. */
  verdict: string;
  results: RunCaseResult[];
}
