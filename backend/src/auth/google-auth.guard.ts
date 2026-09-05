import { Injectable, Logger } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  private readonly logger = new Logger(GoogleAuthGuard.name);

  handleRequest(err: any, user: any, info: any) {
    // A falsy user here can mean two very different things: our own
    // GoogleStrategy.validate() rejected the email (already logged there),
    // or Passport itself never got that far — e.g. Google returned
    // access_denied, or the token exchange failed because of bad
    // client credentials. That second case used to fail completely
    // silently, which is exactly why "no @thapar.edu email found" never
    // showed up in the logs even for logins that should have matched.
    if (err || !user) {
      this.logger.warn(
        `Google auth guard produced no user — err=${err ? (err.message ?? String(err)) : 'none'} info=${info ? JSON.stringify(info) : 'none'}`,
      );
    }
    // Don't throw when login fails — just pass along whatever we got
    // (a user object on success, or falsy on rejection) to the controller
    return user;
  }
}