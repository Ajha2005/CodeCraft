import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { readJwtSecret } from '../config/env';
import { AccessTokenPayload, AuthUser, userFromPayload } from './auth-user';
import { JWT_ALGORITHM, JWT_AUDIENCE, JWT_ISSUER } from './jwt.config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: readJwtSecret(),
      algorithms: [JWT_ALGORITHM],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
  }

  // Whatever this returns becomes `req.user`. Tokens are stateless: nothing is
  // looked up here, so a request costs one signature check and no query.
  validate(payload: Partial<AccessTokenPayload>): AuthUser {
    const user = userFromPayload(payload);
    if (!user) throw new UnauthorizedException();
    return user;
  }
}
