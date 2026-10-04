import { IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  // Not checked with @IsEmail on purpose: the service normalises the address and
  // answers every failure with the same message.
  @IsString()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}
