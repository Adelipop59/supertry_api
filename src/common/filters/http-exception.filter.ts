import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const prismaResult = this.handlePrismaError(exception);
      statusCode = prismaResult.statusCode;
      message = prismaResult.message;
      error = this.getErrorName(statusCode);
    } else if (exception instanceof HttpException) {
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

  private handlePrismaError(exception: Prisma.PrismaClientKnownRequestError): {
    statusCode: number;
    message: string;
  } {
    switch (exception.code) {
      case 'P2002': {
        const target = (exception.meta?.target as string[])?.join(', ') || 'field';
        return { statusCode: HttpStatus.CONFLICT, message: `Un enregistrement avec ce ${target} existe déjà` };
      }
      case 'P2003': {
        const field = (exception.meta?.field_name as string) || 'relation';
        return { statusCode: HttpStatus.BAD_REQUEST, message: `Référence invalide : ${field}` };
      }
      case 'P2025':
        return { statusCode: HttpStatus.NOT_FOUND, message: 'Enregistrement non trouvé' };
      default:
        this.logger.error(`Prisma error ${exception.code}: ${exception.message}`);
        return { statusCode: HttpStatus.INTERNAL_SERVER_ERROR, message: 'Erreur de base de données' };
    }
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
