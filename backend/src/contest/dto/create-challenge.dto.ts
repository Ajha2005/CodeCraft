import {
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreateChallengeDto {
  @IsString()
  cellId!: string;

  // Left to the server (picked by the contested cell's tier) when omitted —
  // see ContestService.pickProblemForCell.
  @IsOptional()
  @IsInt()
  @IsPositive()
  problemId?: number;

  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(1800)
  durationSeconds?: number;
}
