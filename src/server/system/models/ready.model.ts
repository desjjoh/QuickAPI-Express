import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

import { OutputValidationError } from '@/common/exceptions/http.exception';

extendZodWithOpenApi(z);

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

export type ReadyResponse = z.infer<typeof ReadyResponseSchema>;

export function toReadyDTO(payload: ReadyResponse): ReadyResponse {
  const { success, error, data } = ReadyResponseSchema.safeParse(payload);

  if (!success) throw new OutputValidationError('Failed to validate response DTO', error.issues);

  return data;
}
