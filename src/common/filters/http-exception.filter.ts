import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Global exception filter that standardizes ALL error responses.
 * Format: { statusCode, message, error, timestamp, path }
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let statusCode: number;
    let message: string | string[];
    let error: string;
    let extraFields: Record<string, unknown> = {};

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
        error = this.getErrorName(statusCode);
      } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const resp = exceptionResponse as Record<string, unknown>;

        // Preserve ValidationPipe array format for 400 errors
        if (Array.isArray(resp.message)) {
          message = resp.message as string[];
        } else {
          message = (resp.message as string) || exception.message;
        }

        error = (resp.error as string) || this.getErrorName(statusCode);

        // Preserve custom fields (e.g., identityRequired from Stripe)
        const reservedKeys = ['statusCode', 'message', 'error'];
        for (const key of Object.keys(resp)) {
          if (!reservedKeys.includes(key)) {
            extraFields[key] = resp[key];
          }
        }
      } else {
        message = exception.message;
        error = this.getErrorName(statusCode);
      }
    } else {
      // Unknown/unhandled exception → 500
      statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Internal server error';
      error = 'Internal Server Error';

      this.logger.error(
        `Unhandled exception: ${exception instanceof Error ? exception.message : 'Unknown error'}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(statusCode).json({
      statusCode,
      message,
      error,
      timestamp: new Date().toISOString(),
      path: request.url,
      ...extraFields,
    });
  }

  private getErrorName(statusCode: number): string {
    const names: Record<number, string> = {
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      409: 'Conflict',
      422: 'Unprocessable Entity',
      429: 'Too Many Requests',
      500: 'Internal Server Error',
    };
    return names[statusCode] || 'Error';
  }
}
