import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Behind Nginx the visitor's address arrives in X-Forwarded-For. Trust exactly
  // that many proxy hops (1 for one Nginx in front) so the per-IP limits on the
  // demo count real visitors and not the proxy. Leave it unset when nothing sits in front.
  const proxyHops = Number(process.env.TRUST_PROXY_HOPS);
  if (Number.isInteger(proxyHops) && proxyHops > 0) app.set('trust proxy', proxyHops);
  app.enableCors({
    origin: [
      'http://localhost:5173',
      'http://localhost:5174',
      ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : []),
    ],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
    }),
  );
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
