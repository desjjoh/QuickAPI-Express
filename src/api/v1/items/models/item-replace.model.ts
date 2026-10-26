import { z } from 'zod';
import { CreateItemSchema } from './item-create.model';
import { ItemVersionInputSchema } from './item-version.model';

export const ReplaceItemSchema = CreateItemSchema.extend(
  ItemVersionInputSchema.shape,
).openapi('ReplaceItemInput', {
  description:
    'Full item replacement with required expected_version. Omitted description becomes null.',
});

export type ReplaceItemInput = z.infer<typeof ReplaceItemSchema>;
