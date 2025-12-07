import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import type { LocalParsedQs } from '@/types/request';

extendZodWithOpenApi(z);

export const PaginationQuerySchema = z
  .object({
    page: z
      .string()
      .optional()
      .default('1')
      .transform(val => Number(val))
      .pipe(z.number().int().positive())
      .openapi({ description: 'Page number to retrieve. Must be a positive integer.', example: 1 }),

    limit: z
      .string()
      .optional()
      .default('25')
      .transform(val => Number(val))
      .pipe(z.number().int().positive().max(100))
      .openapi({
        description:
          'Maximum number of items to return per page. Must be a positive integer up to 100.',
        example: 25,
      }),

    search: z.string().optional().openapi({
      description: 'Optional search query used to filter items by a given term.',
      example: 'sword',
    }),

    order: z.enum(['ASC', 'DESC']).optional().openapi({
      description: 'Sort direction applied to the chosen sort field.',
      example: 'ASC',
    }),
  })
  .openapi('ItemQuery', {
    description: 'Query parameters used for pagination, filtering, and sorting item collections.',
  });

export type PaginationQuery = z.infer<typeof PaginationQuerySchema> & LocalParsedQs;
