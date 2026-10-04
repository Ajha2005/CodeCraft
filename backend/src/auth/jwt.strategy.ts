import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET', 'dev_secret_change_this_in_production'),
    });
  }

  // whatever this returns becomes `req.user` in protected routes.
  // `username` is missing on tokens issued before it was added; GET /auth/me is the source of truth.
  async validate(payload: { sub: string; email: string; username?: string }) {
    return { userId: payload.sub, email: payload.email, username: payload.username };
  }
}