import { Injectable, Logger } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  private readonly logger = new Logger(GoogleAuthGuard.name);

  handleRequest(err: any, user: any, info: any, context: any) {
    // A falsy user here can mean two very different things: our own
    // GoogleStrategy.validate() rejected the email (already logged there
    // as a domain mismatch), or Passport itself never got that far — e.g.
    // Google returned access_denied, or the token exchange failed because
    // of bad client credentials. Those are server misconfiguration, not
    // an email problem, so the controller needs to be able to tell them
    // apart instead of blaming the user's account for both.
    if (err || !user) {
      this.logger.warn(
        `Google auth guard produced no user — err=${err ? (err.message ?? String(err)) : 'none'} info=${info ? JSON.stringify(info) : 'none'}`,
      );
      const req = context?.switchToHttp?.().getRequest?.();
      if (req) {
        req.googleAuthFailureReason = err ? 'oauth_error' : 'domain_not_allowed';
      }
    }
    // Don't throw when login fails — just pass along whatever we got
    // (a user object on success, or falsy on rejection) to the controller
    return user;
  }
}