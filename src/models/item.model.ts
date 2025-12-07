import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { BaseSchema } from './base.model';
import { PaginationQuerySchema } from './pagination.model';

extendZodWithOpenApi(z);

export const ItemSchema = BaseSchema.extend({
  name: z.string().min(1).max(120).openapi({
    description: 'Name of the item. Must be between 1 and 120 characters.',
    example: 'Iron Sword',
  }),
  price: z.coerce.number().positive().openapi({
    description: 'Monetary cost of the item, expressed as a positive number.',
    example: 49.99,
  }),
  description: z.string().max(500).optional().openapi({
    description: 'Optional descriptive text providing additional item details.',
    example: 'A finely crafted steel blade.',
  }),
}).openapi('Item', {
  description: 'Represents a single item resource with metadata, pricing, and descriptive details.',
});

export const ItemResponseSchema = ItemSchema.openapi('ItemResponse', {
  description: 'Response format returned when fetching a single item resource.',
});

export const ItemListResponseSchema = z
  .object({
    data: z.array(ItemResponseSchema).openapi({
      description: 'Array of item resources matching the query parameters.',
    }),
    total: z.number().int().nonnegative().openapi({
      description: 'Total number of items available matching the query filters.',
      example: 42,
    }),
    page: z
      .number()
      .int()
      .positive()
      .openapi({ description: 'Current page of results being returned.', example: 1 }),
    limit: z
      .number()
      .int()
      .positive()
      .openapi({ description: 'Maximum number of items returned per page.', example: 25 }),
  })
  .openapi('ItemListResponse', {
    description: 'Paginated list response containing item data and pagination metadata.',
  });

export const CreateItemSchema = ItemSchema.pick({
  name: true,
  price: true,
  description: true,
}).openapi('CreateItemInput', {
  description: 'Payload required to create a new item resource.',
});

export const UpdateItemSchema = CreateItemSchema.partial()
  .refine(data => Object.keys(data).length > 0, {
    message: 'At least one field must be provided for update.',
  })
  .openapi('UpdateItemInput', {
    description:
      'Payload for partially updating an existing item. At least one field must be provided.',
  });

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
export type CreateItemInput = z.infer<typeof CreateItemSchema>;
export type UpdateItemInput = z.infer<typeof UpdateItemSchema>;

export type ItemResponse = z.infer<typeof ItemResponseSchema>;
export type ItemListResponse = z.infer<typeof ItemListResponseSchema>;
