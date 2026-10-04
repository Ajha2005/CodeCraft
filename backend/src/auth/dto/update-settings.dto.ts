import { IsBoolean } from 'class-validator';

export class UpdateSettingsDto {
  @IsBoolean()
  flavorTextEnabled!: boolean;
}
