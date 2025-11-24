import { z } from 'zod';

export const ErrorResponseSchema = z.object({
  status: z.number().openapi({ example: '503' }),
  message: z.string().openapi({ example: 'Application not ready.' }),
  timestamp: z.string().openapi({ example: '2025-08-14T12:00:00Z' }),
});
