import { HttpException } from '@nestjs/common';

/**
 * Custom exception that carries an i18n translation key and error code.
 * The GlobalExceptionFilter will resolve the translation automatically.
 */
export class I18nHttpException extends HttpException {
  public readonly i18nKey: string;
  public readonly errorCode: string;
  public readonly i18nArgs?: Record<string, any>;
  public readonly extraFields?: Record<string, unknown>;

  constructor(
    i18nKey: string,
    errorCode: string,
    statusCode: number,
    i18nArgs?: Record<string, any>,
    extraFields?: Record<string, unknown>,
  ) {
    super({ i18nKey, errorCode, ...extraFields }, statusCode);
    this.i18nKey = i18nKey;
    this.errorCode = errorCode;
    this.i18nArgs = i18nArgs;
    this.extraFields = extraFields;
  }
}
