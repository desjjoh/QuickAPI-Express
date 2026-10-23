import { z } from 'zod';

export const MAX_RATE_LIMIT_TIMESTAMP_SLOTS = 2_000_000;

/** Bound the combined allocation as well as each individual configuration value. */
export const RateLimitPolicySchema = z
  .object({
    windowMs: z.number().int().min(1).max(86_400_000).default(60_000),
    max: z.number().int().min(1).max(10_000).default(200),
    maxClients: z.number().int().min(1).max(100_000).default(10_000),
  })
  .refine(
    (policy) =>
      policy.max * policy.maxClients <= MAX_RATE_LIMIT_TIMESTAMP_SLOTS,
    {
      message: `Rate limiter storage must not exceed ${MAX_RATE_LIMIT_TIMESTAMP_SLOTS} timestamp slots`,
      path: ['maxClients'],
    },
  );

export const defaultRateLimitPolicy = RateLimitPolicySchema.parse({});
export type RateLimitPolicy = z.infer<typeof RateLimitPolicySchema>;
