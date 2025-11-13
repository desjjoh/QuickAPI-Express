import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

export const PaginationQuerySchema = z
  .object({
    // pagination
    page: z
      .string()
      .optional()
      .default('1')
      .transform(val => Number(val))
      .pipe(z.number().int().positive())
      .openapi({ example: 1 }),

    limit: z
      .string()
      .optional()
      .default('25')
      .transform(val => Number(val))
      .pipe(z.number().int().positive().max(100))
      .openapi({ example: 25 }),

    // filterings
    search: z.string().optional().openapi({ example: 'sword' }),

    // sorting
    sort: z.enum(['name', 'price', 'createdAt']).optional().openapi({
      example: 'price',
    }),

    order: z.enum(['asc', 'desc']).optional().openapi({
      example: 'asc',
    }),
  })
  .openapi('ItemQuery');

export interface LocalParsedQs {
  [key: string]: undefined | string | string[] | LocalParsedQs | LocalParsedQs[];
}

export type PaginationQuery = z.infer<typeof PaginationQuerySchema> & LocalParsedQs;
