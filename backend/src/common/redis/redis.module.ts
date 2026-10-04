import { Logger, Module, Global } from '@nestjs/common';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: () => {
        const logger = new Logger('Redis');
        const client = process.env.REDIS_URL
          ? new Redis(process.env.REDIS_URL, { connectTimeout: 10_000 })
          : new Redis({ host: 'localhost', port: 6379, connectTimeout: 10_000 });
        // Without a listener ioredis dumps "Unhandled error event" lines; the
        // message never contains the connection string, so it is safe to log.
        client.on('error', (err: Error) => logger.warn(`Redis error: ${err.message}`));
        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
