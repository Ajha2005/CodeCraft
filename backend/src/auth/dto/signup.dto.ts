import { IsEmail, IsString, IsOptional, Matches, MinLength } from 'class-validator';

export class SignupDto {
  @IsEmail()
  @Matches(/@thapar\.edu$/, { message: 'Only @thapar.edu emails are allowed' })
  email!: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password!: string;

  @IsOptional()
  @IsString()
  name?: string;
}