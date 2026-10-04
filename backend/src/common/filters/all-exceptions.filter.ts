import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';

interface HttpLikeError {
  status?: number;
  statusCode?: number;
  type?: string;
}

// What a client may learn from a failure: a status and a short fixed sentence.
// Details (stack traces, SQL, Prisma messages, parser output) go to the server
// log only.
const GENERIC_MESSAGES: Record<number, string> = {
  400: 'Bad request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not found',
  409: 'Conflict',
  413: 'Payload too large',
  415: 'Unsupported media type',
  429: 'Too many requests',
};

function prismaStatus(code: unknown): number | null {
  switch (code) {
    case 'P2002': // unique constraint
    case 'P2003': // foreign key
    case 'P2014': // relation violation
      return 409;
    case 'P2025': // record not found
      return 404;
    default:
      return null;
  }
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      this.logger.error(exception instanceof Error ? exception.message : 'Non-HTTP exception');
      return;
    }
    const response = host.switchToHttp().getResponse<Response>();
    if (response.headersSent) return;

    if (exception instanceof HttpException) {
      // Thrown on purpose by our own code, so its message is meant for the client.
      const status = exception.getStatus();
      const body = exception.getResponse();
      response.status(status).json(typeof body === 'string' ? { statusCode: status, message: body } : body);
      return;
    } else {
      const code = (exception as { code?: unknown } | null)?.code;
      const mapped = prismaStatus(code);
      if (mapped) {
        response.status(mapped).json({ statusCode: mapped, message: GENERIC_MESSAGES[mapped] });
        return;
      }
      // Errors raised by the body parser or other http-errors carry their own 4xx status.
      const status = (exception as HttpLikeError | null)?.status ?? (exception as HttpLikeError | null)?.statusCode;
      if (typeof status === 'number' && status >= 400 && status < 500) {
        const type = (exception as HttpLikeError).type;
        const message = type === 'entity.parse.failed' ? 'Malformed JSON body' : (GENERIC_MESSAGES[status] ?? 'Bad request');
        response.status(status).json({ statusCode: status, message });
        return;
      }
    }

    this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : 'Unknown error');
    response.status(500).json({ statusCode: 500, message: 'Internal server error' });
  }
}
