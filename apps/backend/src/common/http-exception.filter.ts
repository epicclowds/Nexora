import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '../generated/prisma/client';

/**
 * Converts every error into a stable JSON shape without leaking stack traces,
 * SQL or internal messages to clients.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const payload =
        typeof body === 'string'
          ? { message: body }
          : (body as Record<string, unknown>);
      res.status(status).json({
        statusCode: status,
        code: (payload.code as string | undefined) ?? HttpStatus[status] ?? 'ERROR',
        message: Array.isArray(payload.message) ? payload.message.join(', ') : (payload.message ?? exception.message),
        ...(payload.issues ? { issues: payload.issues } : {}),
      });
      return;
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === 'P2002') {
      res.status(HttpStatus.CONFLICT).json({ statusCode: 409, code: 'CONFLICT', message: 'A record with these values already exists' });
      return;
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === 'P2025') {
      res.status(HttpStatus.NOT_FOUND).json({ statusCode: 404, code: 'NOT_FOUND', message: 'Record not found' });
      return;
    }

    this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ statusCode: 500, code: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
}
