import { z } from 'zod';

export const IDEMPOTENCY_RETENTION_MS = 86_400_000;
export const IDEMPOTENCY_CLEANUP_INTERVAL_MS = 3_600_000;
export const MAX_IDEMPOTENCY_RESPONSE_BYTES = 65_536;
export const MAX_IDEMPOTENCY_CLEANUP_ROWS = 10_000;

export const IdempotencyPolicySchema = z
  .object({
    maxResponseBytes: z
      .number()
      .int()
      .min(1)
      .max(MAX_IDEMPOTENCY_RESPONSE_BYTES)
      .default(65_536),
    cleanupBatchSize: z.number().int().min(1).max(1000).default(100),
    cleanupMaxBatches: z.number().int().min(1).max(100).default(10),
  })
  .refine(
    (policy) =>
      policy.cleanupBatchSize * policy.cleanupMaxBatches <=
      MAX_IDEMPOTENCY_CLEANUP_ROWS,
    {
      path: ['cleanupMaxBatches'],
      message: 'Cleanup must not exceed 10000 rows per sweep.',
    },
  );

export const defaultIdempotencyPolicy = Object.freeze(
  IdempotencyPolicySchema.parse({}),
);
export type IdempotencyPolicy = z.infer<typeof IdempotencyPolicySchema>;
