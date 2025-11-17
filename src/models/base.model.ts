import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

export const BaseSchema = z.object({
  id: z
    .string()
    .regex(/^[A-Za-z0-9]{16}$/, 'Invalid ID format')
    .openapi({ example: 'A1b2C3d4E5f6G7h8' }),

  createdAt: z.union([z.date(), z.string().transform(v => new Date(v))]).openapi({
    example: '2025-11-17 01:59:41.061333',
  }),

  updatedAt: z.union([z.date(), z.string().transform(v => new Date(v))]).openapi({
    example: '2025-11-17 01:59:41.061333',
  }),
});
