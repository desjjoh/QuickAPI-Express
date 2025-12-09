import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

import { OutputValidationError } from '@/exceptions/http.exception';

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

export const ReadyResponseSchema = z
  .object({
    ready: z.boolean().openapi({
      description:
        'Indicates whether the application has successfully completed startup and is ready to accept traffic.',
      example: true,
    }),
  })
  .openapi('ReadyResponse', {
    description: 'Readiness check response used for load balancers and orchestration systems.',
  });

export const InfoResponseSchema = z
  .object({
    name: z.string().openapi({
      description: 'The name of the running application.',
      example: 'quickapi',
    }),
    version: z.string().openapi({
      description: 'The semantic version of the service.',
      example: '1.0.0',
    }),
    environment: z.string().openapi({
      description: 'The current runtime environment (e.g., development, staging, production).',
      example: 'development',
    }),
    hostname: z.string().openapi({
      description: 'The hostname of the machine the service is running on.',
      example: 'server-001',
    }),
    pid: z.number().openapi({
      description: 'The operating system process identifier (PID) of the running instance.',
      example: 12345,
    }),
  })
  .openapi('SystemInfoResponse', {
    description: 'System-level information about the running application instance.',
  });

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

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type ReadyResponse = z.infer<typeof ReadyResponseSchema>;
export type InfoResponse = z.infer<typeof InfoResponseSchema>;
export type SystemDiagnostics = z.infer<typeof SystemDiagnosticsSchema>;

export function toHealthDTO(payload: HealthResponse): HealthResponse {
  const { success, error, data } = HealthResponseSchema.safeParse(payload);

  if (!success) throw new OutputValidationError('Failed to validate response DTO', error.issues);

  return data;
}

export function toReadyDTO(payload: ReadyResponse): ReadyResponse {
  const { success, error, data } = ReadyResponseSchema.safeParse(payload);

  if (!success) throw new OutputValidationError('Failed to validate response DTO', error.issues);

  return data;
}

export function toInfoDTO(payload: InfoResponse): InfoResponse {
  const { success, error, data } = InfoResponseSchema.safeParse(payload);

  if (!success) throw new OutputValidationError('Failed to validate response DTO', error.issues);

  return data;
}

export function toSystemDiagnosticsDTO(payload: SystemDiagnostics): SystemDiagnostics {
  const { success, error, data } = SystemDiagnosticsSchema.safeParse(payload);

  if (!success) throw new OutputValidationError('Failed to validate response DTO', error.issues);

  return data;
}
