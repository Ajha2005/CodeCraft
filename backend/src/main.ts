import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { listenHost, listenPort, validateEnv } from './config/env';

async function bootstrap() {
  validateEnv(); // a missing or weak setting stops the process here, before anything listens

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  configureApp(app);
  app.enableShutdownHooks();

  // Loopback by default: the public face is Nginx, never this port.
  await app.listen(listenPort(), listenHost());
}

bootstrap().catch((err: unknown) => {
  // The message names settings, never their values.
  new Logger('Bootstrap').error(err instanceof Error ? err.message : 'Failed to start');
  process.exit(1);
});
