import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

import { OutputValidationError } from '@/common/exceptions/http.exception';

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

export type InfoResponse = z.infer<typeof InfoResponseSchema>;

export function toInfoDTO(payload: InfoResponse): InfoResponse {
  const { success, error, data } = InfoResponseSchema.safeParse(payload);

  if (!success) throw new OutputValidationError('Failed to validate response DTO', error.issues);

  return data;
}
