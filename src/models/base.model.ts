import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

export const BaseSchema = z
  .object({
    id: z
      .string()
      .regex(/^[A-Za-z0-9]{16}$/, 'Invalid ID format')
      .openapi({
        description: 'Unique 16-character alphanumeric identifier for the resource.',
        example: 'A1b2C3d4E5f6G7h8',
      }),

    createdAt: z.union([z.date(), z.string().transform(v => new Date(v))]).openapi({
      description:
        'Timestamp indicating when the resource was first created. Returned as an ISO8601 string.',
      example: '2025-11-17T01:59:41.061333Z',
    }),

    updatedAt: z.union([z.date(), z.string().transform(v => new Date(v))]).openapi({
      description:
        'Timestamp indicating when the resource was last modified. Returned as an ISO8601 string.',
      example: '2025-11-17T01:59:41.061333Z',
    }),
  })
  .openapi('BaseSchema', {
    description:
      'Base resource structure containing the canonical ID and creation/update timestamps.',
  });
