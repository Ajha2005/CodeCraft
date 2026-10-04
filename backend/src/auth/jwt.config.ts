import type { JwtModuleOptions, JwtSignOptions } from '@nestjs/jwt';
import { accessTokenTtl, readJwtSecret } from '../config/env';

// One place decides how tokens are signed and checked, so the REST guard, the
// WebSocket handshake and the token issuer can never drift apart.
export const JWT_ALGORITHM = 'HS256' as const;
export const JWT_ISSUER = 'codecraft-api';
export const JWT_AUDIENCE = 'codecraft-app';
export const GUEST_TOKEN_TTL_SECONDS = 2 * 60 * 60;

export function jwtModuleOptions(): JwtModuleOptions {
  return {
    secret: readJwtSecret(), // throws (and the app does not start) when the secret is missing, short or a known placeholder
    signOptions: {
      algorithm: JWT_ALGORITHM,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      expiresIn: accessTokenTtl() as JwtSignOptions['expiresIn'],
    },
    verifyOptions: {
      algorithms: [JWT_ALGORITHM], // pinned: a token claiming "none" or an RSA algorithm is rejected
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    },
  };
}
