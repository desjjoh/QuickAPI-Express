import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

import { ItemSchema } from './item.model';

extendZodWithOpenApi(z);

export const CreateItemSchema = ItemSchema.pick({
  name: true,
  price: true,
  description: true,
}).openapi('CreateItemInput', {
  description: 'Payload required to create a new item resource.',
});

export type CreateItemInput = z.infer<typeof CreateItemSchema>;
