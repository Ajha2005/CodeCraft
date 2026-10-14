import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AccessTokenPayload, AuthUser, userFromPayload } from './auth-user';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET', 'dev_secret_change_this_in_production'),
    });
  }

  // whatever this returns becomes `req.user` in protected routes. Tokens are
  // stateless: nothing is looked up here. A token with no `role` is an account
  // (every token issued before demo sessions existed), `GUEST` is a demo session.
  validate(payload: AccessTokenPayload): AuthUser {
    const user = userFromPayload(payload);
    if (!user) throw new UnauthorizedException();
    return user;
  }
}
