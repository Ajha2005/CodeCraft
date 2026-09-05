import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';

const ALLOWED_DOMAIN = '@thapar.edu';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  private readonly logger = new Logger(GoogleStrategy.name);

  constructor(config: ConfigService) {
    super({
      clientID: config.get<string>('GOOGLE_CLIENT_ID')!,
      clientSecret: config.get<string>('GOOGLE_CLIENT_SECRET')!,
      callbackURL: config.get<string>('GOOGLE_CALLBACK_URL')!,
      scope: ['email', 'profile'],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: any,
    done: VerifyCallback,
  ): Promise<any> {
    // Google can attach more than one email to a profile (e.g. a recovery
    // address); check all of them case-insensitively instead of trusting
    // emails[0] to be the institutional one.
    const emails: { value?: string }[] = profile.emails ?? [];
    const match = emails
      .map((e) => e.value?.trim())
      .find((value) => value?.toLowerCase().endsWith(ALLOWED_DOMAIN));

    if (!match) {
      this.logger.warn(
        `Rejected Google sign-in for profile ${profile.id}: no ${ALLOWED_DOMAIN} email found among [${emails.map((e) => e.value).join(', ')}]`,
      );
      return done(null, false);
    }

    done(null, {
      email: match,
      googleId: profile.id,
      name: profile.displayName,
    });
  }
}