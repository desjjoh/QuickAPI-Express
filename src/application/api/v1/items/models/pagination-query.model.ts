import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

import { PaginationQuerySchema } from '@/library/models/pagination.model';

extendZodWithOpenApi(z);

export const ItemPaginationQuerySchema = PaginationQuerySchema.extend({
  sort: z.enum(['name', 'price', 'createdAt']).optional().openapi({
    description: 'Field used to sort the result set.',
    example: 'price',
  }),

  min_price: z
    .preprocess(value => {
      if (value === undefined || value === null || value === '') return undefined;
      const n = Number(value);
      return Number.isFinite(n) ? n : undefined;
    }, z.number().int().positive().optional())
    .openapi({
      description: 'Minimum price filter',
      example: 50,
    }),

  max_price: z
    .preprocess(value => {
      if (value === undefined || value === null || value === '') return undefined;
      const n = Number(value);
      return Number.isFinite(n) ? n : undefined;
    }, z.number().int().positive().optional())
    .openapi({
      description: 'Maximum price filter',
      example: 100,
    }),
}).refine(
  ({ min_price, max_price }) => {
    const isMinPriceValid = min_price != null && Number.isFinite(min_price);
    const isMaxPriceValid = max_price != null && Number.isFinite(max_price);

    if (isMinPriceValid && isMaxPriceValid) {
      return min_price <= max_price;
    }

    return true;
  },
  {
    message: 'min_price cannot be greater than max_price',
    path: ['min_price'],
  },
);

export type ItemPaginationQuery = z.infer<typeof ItemPaginationQuerySchema>;
