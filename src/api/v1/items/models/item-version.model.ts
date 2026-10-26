import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

export const ItemVersionSchema = z
  .number()
  .int()
  .min(1)
  .max(4294967295)
  .openapi({
    description:
      'Item revision. Send the version from the last read as expected_version for mutations.',
    example: 1,
  });

export const ItemVersionInputSchema = z
  .object({
    expected_version: ItemVersionSchema,
  })
  .openapi('ItemVersionInput', {
    description:
      'Required revision precondition. Missing/invalid versions return 422; stale versions return 409.',
  });

export type ItemVersionInput = z.infer<typeof ItemVersionInputSchema>;
