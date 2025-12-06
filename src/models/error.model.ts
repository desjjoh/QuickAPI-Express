import { z } from 'zod';

export const ErrorResponseSchema = z
  .object({
    status: z
      .number()
      .openapi({ description: 'HTTP status code associated with this error.', example: 503 }),
    message: z.string().openapi({
      description: 'Human-readable message describing the error condition.',
      example: 'Application not ready.',
    }),
    timestamp: z.number().openapi({
      description: 'Unix timestamp (milliseconds since epoch) indicating when the error occurred.',
      example: 1755172800000,
    }),
  })
  .openapi('ErrorResponseSchema', {
    description: 'Standard error envelope returned by all API endpoints when an operation fails.',
  });
