import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { ErrorResponseDto, ValidationErrorResponseDto } from '../dto/error-response.dto';

/**
 * Adds 401 + 403 error responses to Swagger documentation.
 * Use on all authenticated endpoints.
 */
export function ApiAuthResponses() {
  return applyDecorators(
    ApiResponse({
      status: 401,
      description: 'Unauthorized – missing or invalid session',
      type: ErrorResponseDto,
    }),
    ApiResponse({
      status: 403,
      description: 'Forbidden – insufficient permissions',
      type: ErrorResponseDto,
    }),
  );
}

/**
 * Adds 404 error response to Swagger documentation.
 * Use on endpoints that fetch a resource by ID.
 */
export function ApiNotFoundErrorResponse() {
  return applyDecorators(
    ApiResponse({
      status: 404,
      description: 'Resource not found',
      type: ErrorResponseDto,
    }),
  );
}

/**
 * Adds 400 validation error response to Swagger documentation.
 * Use on endpoints that accept a request body.
 */
export function ApiValidationErrorResponse() {
  return applyDecorators(
    ApiResponse({
      status: 400,
      description: 'Validation error – invalid request body',
      type: ValidationErrorResponseDto,
    }),
  );
}

/**
 * Combines 401 + 403 + 404 + 400 error responses.
 * Use on authenticated endpoints with body + resource ID.
 */
export function ApiStandardErrors() {
  return applyDecorators(
    ApiAuthResponses(),
    ApiNotFoundErrorResponse(),
    ApiValidationErrorResponse(),
  );
}
