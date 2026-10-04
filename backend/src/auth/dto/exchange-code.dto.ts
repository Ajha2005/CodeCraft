import { IsString, Matches } from 'class-validator';

export class ExchangeCodeDto {
  // 32 random bytes, base64url (see LoginCodeService)
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/, { message: 'Invalid code' })
  code!: string;
}
