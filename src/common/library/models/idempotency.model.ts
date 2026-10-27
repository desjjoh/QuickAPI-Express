import { z } from 'zod';

export const IdempotencyKeySchema = z
  .string()
  .min(1)
  .max(128)
  .refine((key) => !/[^\x21-\x7e]|,/.test(key), {
    message: 'Use one printable ASCII key without whitespace or commas.',
  });
export const IdempotencyHashSchema = z
  .string()
  .length(64)
  .regex(/^[a-f0-9]{64}$/);
export const IdempotencyScopeSchema = z
  .object({
    namespace: z.string().min(1).max(256),
    callerScope: z.string().min(1).max(128),
    operation: z.string().min(1).max(128),
    route: z.string().min(1).max(512),
  })
  .strict();
export const IdempotencyClaimSchema = z
  .object({
    scopeHash: IdempotencyHashSchema,
    fingerprint: IdempotencyHashSchema,
    scope: IdempotencyScopeSchema,
  })
  .strict();
export const PreparedJsonResponseSchema = z
  .object({
    status: z.number().int().min(200).max(299),
    json: z.string().optional(),
  })
  .strict();

export type IdempotencyScope = z.infer<typeof IdempotencyScopeSchema>;
export type IdempotencyClaim = z.infer<typeof IdempotencyClaimSchema>;
export type PreparedJsonResponse = z.infer<typeof PreparedJsonResponseSchema>;
export interface IdempotencyFingerprintInput {
  body: unknown;
  params?: unknown;
  query?: unknown;
}
