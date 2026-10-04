import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { isAllowedOrigin, isProduction, trustProxyHops } from './config/env';

/**
 * Everything that is configured on the HTTP app rather than in a module.
 * main.ts and the end-to-end tests both call this, so the tests exercise the
 * same headers, limits and pipes as production.
 */
export function configureApp(app: NestExpressApplication): void {
  app.disable('x-powered-by');
  // One reverse proxy (Nginx) sits in front: believe exactly one X-Forwarded-For hop, so
  // req.ip is the real client and a spoofed header cannot pick its own address.
  app.set('trust proxy', trustProxyHops());

  // The API only returns JSON. This CSP makes a response that is somehow
  // rendered as a page inert: no scripts, no framing, no forms, no base tag.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] },
      },
      hsts: isProduction() ? { maxAge: 31_536_000, includeSubDomains: true } : false,
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  // Private by default; the few cacheable responses (the static map grid) set their own header.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use(compression({ threshold: 1024 }));

  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => callback(null, isAllowedOrigin(origin)),
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  });

  app.useBodyParser('json', { limit: '64kb' });
  app.useBodyParser('urlencoded', { limit: '16kb', extended: false });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      stopAtFirstError: true,
    }),
  );
}
