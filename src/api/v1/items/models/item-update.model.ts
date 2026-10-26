import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { ItemVersionInputSchema } from './item-version.model';
import { CreateItemSchema } from './item-create.model';

extendZodWithOpenApi(z);

export const UpdateItemSchema = CreateItemSchema.partial()
  .extend(ItemVersionInputSchema.shape)
  .refine(
    (data) => Object.keys(data).some((key) => key !== 'expected_version'),
    {
      message: 'At least one field must be provided for update.',
    },
  )
  .openapi('UpdateItemInput', {
    description:
      'Payload for partially updating an existing item. At least one field must be provided.',
  });

export type UpdateItemInput = z.infer<typeof UpdateItemSchema>;
