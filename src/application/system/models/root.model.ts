import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

import { OutputValidationError } from '@/common/exceptions/http.exception';

extendZodWithOpenApi(z);

export const RootResponseSchema = z
  .object({
    message: z.string().openapi({
      description:
        'Indicates whether the application has successfully completed startup and is ready to accept traffic.',
      example: true,
    }),
  })
  .openapi('ReadyResponse', {
    description: 'Readiness check response used for load balancers and orchestration systems.',
  });

export type RootResponse = z.infer<typeof RootResponseSchema>;

export function toRootDTO(payload: RootResponse): RootResponse {
  const { success, error, data } = RootResponseSchema.safeParse(payload);

  if (!success) throw new OutputValidationError('Failed to validate response DTO', error.issues);

  return data;
}
