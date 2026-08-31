import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

import { OutputValidationError } from '@/common/exceptions/http.exception';
import { EnvSchema } from '@/config/env.config';

extendZodWithOpenApi(z);

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
    environment: z.enum(EnvSchema.shape.NODE_ENV.options).openapi({
      description: 'The current runtime environment (e.g., development, staging, production).',
      example: 'development',
    }),
    hostname: z.string().openapi({
      description: 'The hostname of the machine the service is running on.',
      example: 'server-001',
    }),
    pid: z.number().int().positive().openapi({
      description: 'The operating system process identifier (PID) of the running instance.',
      example: 12345,
    }),
    node_version: z.string().trim().min(1).openapi({
      description: 'The version of Node.js running the service.',
      example: 'v24.10.0',
    }),
    platform: z.string().trim().min(1).openapi({
      description: 'The operating system platform running the service.',
      example: 'linux',
    }),
    architecture: z.string().trim().min(1).openapi({
      description: 'The processor architecture running the service.',
      example: 'x64',
    }),
    started_at: z.iso.datetime().openapi({
      description: 'The ISO-8601 timestamp at which the service process started.',
      example: '2026-08-31T12:00:00.000Z',
    }),
    timezone: z.string().trim().min(1).openapi({
      description: 'The IANA time zone resolved by the runtime.',
      example: 'Etc/UTC',
    }),
  })
  .openapi('SystemInfoResponse', {
    description: 'System-level information about the running application instance.',
  });

export type InfoResponse = z.infer<typeof InfoResponseSchema>;

export function toInfoDTO(payload: InfoResponse): InfoResponse {
  const { success, error, data } = InfoResponseSchema.safeParse(payload);

  if (!success) throw new OutputValidationError('Failed to validate response DTO', error.issues);

  return data;
}
