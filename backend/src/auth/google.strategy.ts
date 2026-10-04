import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { normalizeEmail } from './email.util';

/** What the Google guard puts on `req.googleUser` after a successful sign-in. */
export interface GoogleUser {
  email: string;
  googleId: string;
}

interface GoogleProfile {
  id: string;
  emails?: { value?: string; verified?: boolean | string }[];
}

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

  validate(_accessToken: string, _refreshToken: string, profile: GoogleProfile, done: VerifyCallback): void {
    // Google can attach more than one address to a profile (e.g. a recovery
    // address). Take the first one that Google itself marks as verified and
    // that is an acceptable @thapar.edu address in canonical form.
    const emails = profile.emails ?? [];
    const match = emails
      .filter((entry) => entry.verified === true || entry.verified === 'true')
      .map((entry) => normalizeEmail(entry.value))
      .find((value): value is string => value !== null);

    if (!match) {
      // Addresses are personal data: log how many were offered, never which.
      this.logger.warn(`Rejected Google sign-in for profile ${profile.id}: none of its ${emails.length} address(es) is a verified @thapar.edu account`);
      return done(null, false);
    }

    const user: GoogleUser = { email: match, googleId: profile.id };
    done(null, user);
  }
}
