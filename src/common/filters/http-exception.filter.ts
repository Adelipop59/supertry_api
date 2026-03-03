import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { I18nService } from 'nestjs-i18n';
import { I18nHttpException } from '../exceptions/i18n.exception';

/**
 * Global exception filter that standardizes ALL error responses.
 * Supports i18n translation via I18nHttpException.
 * Format: { statusCode, message, errorCode?, error, timestamp, path }
 */
@Injectable()
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  constructor(private readonly i18n: I18nService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // Skip non-HTTP contexts (WebSocket, etc.)
    if (!response?.status) return;

    let statusCode: number;
    let message: string | string[];
    let error: string;
    let errorCode: string | undefined;
    let extraFields: Record<string, unknown> = {};

    // Resolve language from request
    const lang = this.resolveLanguage(request);

    if (exception instanceof I18nHttpException) {
      // i18n-aware exception: translate the message
      statusCode = exception.getStatus();
      errorCode = exception.errorCode;
      error = this.getErrorName(statusCode);
      extraFields = exception.extraFields || {};

      try {
        message = this.i18n.t(exception.i18nKey, {
          lang,
          args: exception.i18nArgs,
        });
      } catch {
        // Fallback to key if translation fails
        this.logger.warn(`Missing translation for key: ${exception.i18nKey} (lang: ${lang})`);
        message = exception.i18nKey;
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const prismaResult = this.handlePrismaError(exception, lang);
      statusCode = prismaResult.statusCode;
      message = prismaResult.message;
      errorCode = prismaResult.errorCode;
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
        errorCode = resp.errorCode as string | undefined;

        // Preserve custom fields (e.g., identityRequired from Stripe)
        const reservedKeys = ['statusCode', 'message', 'error', 'errorCode', 'i18nKey'];
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
      errorCode = 'INTERNAL_ERROR';
      error = 'Internal Server Error';

      try {
        message = this.i18n.t('common.internal_error', { lang });
      } catch {
        message = 'Internal server error';
      }

      this.logger.error(
        `Unhandled exception: ${exception instanceof Error ? exception.message : 'Unknown error'}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    const responseBody: Record<string, unknown> = {
      statusCode,
      message,
      error,
      timestamp: new Date().toISOString(),
      path: request.url,
      ...extraFields,
    };

    if (errorCode) {
      responseBody.errorCode = errorCode;
    }

    response.status(statusCode).json(responseBody);
  }

  private handlePrismaError(
    exception: Prisma.PrismaClientKnownRequestError,
    lang: string,
  ): {
    statusCode: number;
    message: string;
    errorCode: string;
  } {
    switch (exception.code) {
      case 'P2002': {
        const target = (exception.meta?.target as string[])?.join(', ') || 'field';
        return {
          statusCode: HttpStatus.CONFLICT,
          message: this.i18n.t('common.duplicate', { lang, args: { field: target } }),
          errorCode: 'DUPLICATE_ENTRY',
        };
      }
      case 'P2003': {
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          message: this.i18n.t('common.invalid_reference', { lang }),
          errorCode: 'INVALID_REFERENCE',
        };
      }
      case 'P2025':
        return {
          statusCode: HttpStatus.NOT_FOUND,
          message: this.i18n.t('common.not_found', { lang }),
          errorCode: 'NOT_FOUND',
        };
      default:
        this.logger.error(`Prisma error ${exception.code}: ${exception.message}`);
        return {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: this.i18n.t('common.database_error', { lang }),
          errorCode: 'DATABASE_ERROR',
        };
    }
  }

  private resolveLanguage(request: Request): string {
    // 1. x-lang header
    const xLang = request?.headers?.['x-lang'];
    if (xLang && typeof xLang === 'string') {
      const lang = xLang.toLowerCase().substring(0, 2);
      if (['fr', 'en', 'es', 'de', 'it', 'pt'].includes(lang)) return lang;
    }

    // 2. User's profile preferred language
    const user = (request as any)?.user;
    if (user?.preferredLanguage) {
      return user.preferredLanguage.toLowerCase();
    }

    // 3. Accept-Language header
    const acceptLang = request?.headers?.['accept-language'];
    if (acceptLang && typeof acceptLang === 'string') {
      const lang = acceptLang.toLowerCase().substring(0, 2);
      if (['fr', 'en', 'es', 'de', 'it', 'pt'].includes(lang)) return lang;
    }

    // 4. Fallback
    return 'fr';
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
