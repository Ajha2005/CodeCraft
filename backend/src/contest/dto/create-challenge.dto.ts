import {
  IsInt,
  IsOptional,
  IsPositive,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class CreateChallengeDto {
  @IsUUID()
  cellId!: string;

  // The challenger's own cell, put at stake: lose the duel and it goes to the
  // defender. Must be a cell the challenger holds right now.
  @IsUUID()
  pledgedCellId!: string;

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
