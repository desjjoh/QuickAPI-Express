import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

import { PriceSchema } from '@/common/library/models/price.model';
import { PaginationQuerySchema } from '@/common/library/models/pagination.model';

extendZodWithOpenApi(z);

export const ItemPaginationQuerySchema = PaginationQuerySchema.extend({
  sort: z.enum(['name', 'price', 'createdAt']).optional().openapi({
    description: 'Field used to sort the result set.',
    example: 'price',
  }),

  min_price: PriceSchema.optional().openapi({
    description: 'Inclusive minimum price; same two-decimal price contract.',
    example: 5.25,
  }),
  max_price: PriceSchema.optional().openapi({
    description: 'Inclusive maximum price; same two-decimal price contract.',
    example: 10.5,
  }),
})
  .refine(({ page, limit }) => Number.isSafeInteger((page - 1) * limit), {
    path: ['page'],
    message: 'Page and limit produce an unsafe pagination offset.',
  })
  .refine(
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
