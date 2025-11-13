import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { BaseSchema } from './base.model';

extendZodWithOpenApi(z);

export const ItemSchema = BaseSchema.extend({
  name: z.string().min(1).max(120).openapi({ example: 'Iron Sword' }),
  price: z.number().positive().openapi({ example: 49.99 }),
  description: z.string().max(500).optional().openapi({ example: 'A finely crafted steel blade.' }),
});

export const ItemResponseSchema = ItemSchema.openapi('ItemResponse');

export const ItemListResponseSchema = z
  .object({
    data: z.array(ItemResponseSchema),
    total: z.number().int().nonnegative().openapi({ example: 42 }),
    page: z.number().int().positive().openapi({ example: 1 }),
    limit: z.number().int().positive().openapi({ example: 25 }),
  })
  .openapi('ItemListResponse');

export const CreateItemSchema = ItemSchema.pick({
  name: true,
  price: true,
  description: true,
}).openapi('CreateUserInput');

export const UpdateItemSchema = CreateItemSchema.partial()
  .refine(data => Object.keys(data).length > 0, {
    message: 'At least one field must be provided for update.',
  })
  .openapi('UpdateUserInput');

export type CreateItemInput = z.infer<typeof CreateItemSchema>;
export type UpdateItemInput = z.infer<typeof UpdateItemSchema>;

export type ItemResponse = z.infer<typeof ItemResponseSchema>;
export type ItemListResponse = z.infer<typeof ItemListResponseSchema>;
