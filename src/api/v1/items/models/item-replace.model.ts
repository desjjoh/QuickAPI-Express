import { z } from 'zod';
import { CreateItemSchema } from './item-create.model';
import { VersionInputSchema } from '@/common/library/models/version.model';

export const ReplaceItemSchema = CreateItemSchema.extend(
  VersionInputSchema.shape,
).openapi('ReplaceItemInput', {
  description:
    'Full item replacement with required expected_version. Omitted description becomes null.',
});

export type ReplaceItemInput = z.infer<typeof ReplaceItemSchema>;
