import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

import type { Item } from '@/database/entities/item.entity';
import { BaseSchema } from '@/library/models/base.model';
import { OutputValidationError } from '@/common/exceptions/http.exception';
import { PaginatedResponseSchema, type ListDTOParams } from '@/library/models/pagination.model';

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

export type ItemResponse = z.infer<typeof ItemResponseSchema>;

export function toItemDTO(entity: Item): ItemResponse {
  const { success, error, data } = ItemResponseSchema.safeParse(entity);

  if (!success) throw new OutputValidationError('Failed to validate response DTO', error.issues);

  return data;
}

export const ItemListResponseSchema = PaginatedResponseSchema(ItemResponseSchema).openapi(
  'ItemListResponse',
  {
    description: 'Paginated list response containing item data and pagination metadata.',
  },
);

export type ItemListResponse = z.infer<typeof ItemListResponseSchema>;

export function toItemListDTO(payload: ListDTOParams<Item>): ItemListResponse {
  const { success, error, data } = ItemListResponseSchema.safeParse({
    ...payload,
    data: payload.items.map(toItemDTO),
  });

  if (!success) throw new OutputValidationError('Failed to validate response DTO', error.issues);

  return data;
}
