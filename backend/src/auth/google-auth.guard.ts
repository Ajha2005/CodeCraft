import { ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { randomBytes, timingSafeEqual } from 'crypto';
import type { Request, Response } from 'express';
import { isProduction } from '../config/env';

export const OAUTH_STATE_COOKIE = 'cc_oauth_state';
const STATE_TTL_MS = 10 * 60 * 1000;

function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return null;
}

function sameValue(a: string | null, b: unknown): boolean {
  if (!a || typeof b !== 'string') return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

const isCallback = (request: Request) => request.path.replace(/\/+$/, '').endsWith('/callback');

/**
 * Google sign-in with a login-CSRF defence. Starting the flow sets a random
 * `state` both in the redirect to Google and in a short-lived HttpOnly cookie;
 * the callback is only honoured if Google hands back the same value, so an
 * attacker cannot complete a sign-in they started and push it into a victim's
 * browser.
 */
@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  private readonly logger = new Logger(GoogleAuthGuard.name);

  getAuthenticateOptions(context: ExecutionContext) {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    // `googleUser`, not `user`: req.user is reserved for our own access-token identity.
    if (isCallback(request)) return { property: 'googleUser' };

    const state = randomBytes(24).toString('base64url');
    http.getResponse<Response>().cookie(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      secure: isProduction(),
      sameSite: 'lax', // the callback is a top-level GET navigation from Google, which Lax allows
      path: '/auth/google',
      maxAge: STATE_TTL_MS,
    });
    return { property: 'googleUser', state, prompt: 'select_account', hd: 'thapar.edu' };
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request & { googleAuthFailureReason?: string }>();
    if (isCallback(request)) {
      const expected = readCookie(request, OAUTH_STATE_COOKIE);
      http.getResponse<Response>().clearCookie(OAUTH_STATE_COOKIE, { path: '/auth/google' });
      if (!sameValue(expected, request.query.state)) {
        this.logger.warn('Google callback rejected: state did not match the cookie');
        request.googleAuthFailureReason = 'oauth_error';
        return true; // the controller redirects back to the login page with an error
      }
    }
    return (await super.canActivate(context)) as boolean;
  }

  handleRequest(err: any, user: any, info: any, context: any) {
    // A falsy user here can mean two very different things: our own
    // GoogleStrategy.validate() rejected the account (not a verified
    // @thapar.edu address), or Passport itself never got that far (Google
    // returned access_denied, or the code exchange failed). The controller
    // needs to tell them apart rather than blame the user's account for both.
    if (err || !user) {
      this.logger.warn(`Google auth produced no user (${err ? 'oauth error' : 'account not allowed'})`);
      const req = context?.switchToHttp?.().getRequest?.();
      if (req) req.googleAuthFailureReason = err ? 'oauth_error' : 'domain_not_allowed';
    }
    // Don't throw when login fails: pass along whatever we got (a user on
    // success, falsy on rejection) so the controller can redirect with a reason.
    return user;
  }
}
