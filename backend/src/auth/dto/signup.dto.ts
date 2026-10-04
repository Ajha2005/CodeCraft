import { Transform } from 'class-transformer';
import { IsEmail, IsString, IsOptional, Length, Matches, MinLength } from 'class-validator';

export class SignupDto {
  @IsEmail()
  @Matches(/@thapar\.edu$/, { message: 'Only @thapar.edu emails are allowed' })
  email!: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password!: string;

  // Trimmed and lowercased before validation, so "Arjun_M" and "arjun_m" are one name.
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @Matches(/^[a-z0-9_]+$/, { message: 'Username can only contain letters, numbers and underscores' })
  @Length(3, 20, { message: 'Username must be 3-20 characters' })
  @IsString({ message: 'Username is required' }) // listed last so it is reported first
  username!: string;

  @IsOptional()
  @IsString()
  name?: string;
}