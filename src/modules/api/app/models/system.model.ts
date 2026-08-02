import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

import { OutputValidationError } from '@/common/exceptions/http.exception';

extendZodWithOpenApi(z);

export const SystemDiagnosticsSchema = z
  .object({
    uptime: z.number().openapi({
      description: 'System uptime in seconds.',
      example: 123456,
    }),
    timestamp: z.number().openapi({
      description:
        'Current timestamp in milliseconds since the UNIX epoch when the diagnostics snapshot was created.',
      example: 1731612345123,
    }),
    eventLoopLag: z.number().openapi({
      description: 'Estimated event loop delay in milliseconds, used as a measure of load.',
      example: 4.2,
    }),
    db: z.enum(['connected', 'disconnected']).openapi({
      description: 'The current connectivity status of the database layer.',
      example: 'connected',
    }),
  })
  .openapi('SystemDiagnostics', {
    description: 'Low-level system diagnostics useful for monitoring and health dashboards.',
  });

export type SystemDiagnostics = z.infer<typeof SystemDiagnosticsSchema>;

export function toSystemDiagnosticsDTO(payload: SystemDiagnostics): SystemDiagnostics {
  const { success, error, data } = SystemDiagnosticsSchema.safeParse(payload);

  if (!success) throw new OutputValidationError('Failed to validate response DTO', error.issues);

  return data;
}
