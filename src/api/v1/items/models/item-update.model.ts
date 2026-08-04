import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { CreateItemSchema } from './item-create.model';

extendZodWithOpenApi(z);

export const UpdateItemSchema = CreateItemSchema.partial()
  .refine((data: Partial<z.infer<typeof CreateItemSchema>>) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided for update.',
  })
  .openapi('UpdateItemInput', {
    description:
      'Payload for partially updating an existing item. At least one field must be provided.',
  });

export type UpdateItemInput = z.infer<typeof UpdateItemSchema>;
