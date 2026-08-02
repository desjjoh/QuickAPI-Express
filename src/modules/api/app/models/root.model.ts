import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

import { OutputValidationError } from '@/common/exceptions/http.exception';

extendZodWithOpenApi(z);

export const RootResponseSchema = z
  .object({
    message: z.string().openapi({
      description: 'A welcome message returned by the application root endpoint.',
      example: 'Hello World! Welcome to Express.js',
    }),
  })
  .openapi('RootResponse', {
    description: 'Welcome response returned by the application root endpoint.',
  });

export type RootResponse = z.infer<typeof RootResponseSchema>;

export function toRootDTO(payload: RootResponse): RootResponse {
  const { success, error, data } = RootResponseSchema.safeParse(payload);

  if (!success) throw new OutputValidationError('Failed to validate response DTO', error.issues);

  return data;
}
