import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

import { OutputValidationError } from '@/common/exceptions/http.exception';

extendZodWithOpenApi(z);

export const HealthResponseSchema = z
  .object({
    alive: z.boolean().openapi({
      description: 'Indicates whether the application is currently running.',
      example: true,
    }),
    uptime: z.number().openapi({
      description: 'Process uptime expressed in seconds.',
      example: 123.45,
    }),
    timestamp: z.string().openapi({
      description: 'ISO8601 timestamp representing when the health status was generated.',
      example: '2025-08-14T12:00:00Z',
    }),
  })
  .openapi('HealthResponse', {
    description: 'Health check response indicating basic liveness information for the service.',
  });

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export function toHealthDTO(payload: HealthResponse): HealthResponse {
  const { success, error, data } = HealthResponseSchema.safeParse(payload);

  if (!success) throw new OutputValidationError('Failed to validate response DTO', error.issues);

  return data;
}
