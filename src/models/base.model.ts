import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

export const BaseSchema = z.object({
  id: z.number().int().openapi({ example: 1 }),

  createdAt: z.iso.datetime().openapi({
    example: '2025-10-29T14:30:00Z',
  }),

  updatedAt: z.iso.datetime().openapi({
    example: '2025-10-29T14:35:00Z',
  }),
});
