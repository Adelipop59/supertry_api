import { ApiProperty } from '@nestjs/swagger';

/**
 * Standard error response DTO for Swagger documentation
 */
export class ErrorResponseDto {
  @ApiProperty({ example: 404, description: 'HTTP status code' })
  statusCode: number;

  @ApiProperty({
    example: 'Resource not found',
    description: 'Error message(s)',
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
  })
  message: string | string[];

  @ApiProperty({ example: 'Not Found', description: 'HTTP error name' })
  error: string;

  @ApiProperty({
    example: '2026-02-17T12:00:00.000Z',
    description: 'Timestamp of the error',
  })
  timestamp: string;

  @ApiProperty({ example: '/api/v1/campaigns/123', description: 'Request path' })
  path: string;
}

/**
 * Validation error response DTO (400 Bad Request from ValidationPipe)
 */
export class ValidationErrorResponseDto {
  @ApiProperty({ example: 400 })
  statusCode: number;

  @ApiProperty({
    example: ['title must be a string', 'price must be a positive number'],
    description: 'Array of validation error messages',
    type: [String],
  })
  message: string[];

  @ApiProperty({ example: 'Bad Request' })
  error: string;

  @ApiProperty({ example: '2026-02-17T12:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: '/api/v1/products' })
  path: string;
}
