import {
  Inject,
  Injectable,
  Logger,
  Module,
  Global,
  OnApplicationShutdown,
} from '@nestjs/common';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

/** Closes the connection when the app shuts down (pm2 restart, SIGTERM, test teardown) instead of leaving it to the OS. */
@Injectable()
class RedisShutdown implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: () => {
        const logger = new Logger('Redis');
        const client = process.env.REDIS_URL
          ? new Redis(process.env.REDIS_URL, { connectTimeout: 10_000 })
          : new Redis({
              host: 'localhost',
              port: 6379,
              connectTimeout: 10_000,
            });
        // Without a listener ioredis dumps "Unhandled error event" lines; the
        // message never contains the connection string, so it is safe to log.
        client.on('error', (err: Error) =>
          logger.warn(`Redis error: ${err.message}`),
        );
        return client;
      },
    },
    RedisShutdown,
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
