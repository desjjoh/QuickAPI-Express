import { env } from './env.config';
import {
  IdempotencyPolicySchema,
  IDEMPOTENCY_RETENTION_MS,
  IDEMPOTENCY_CLEANUP_INTERVAL_MS,
} from '@/common/library/models/idempotency-policy.model';

/** Validated policy only; no timer, execution service, or endpoint is enabled here. */
export const idempotencyPolicy = Object.freeze({
  ...IdempotencyPolicySchema.parse({
    maxResponseBytes: env.IDEMPOTENCY_MAX_RESPONSE_BYTES,
    cleanupBatchSize: env.IDEMPOTENCY_CLEANUP_BATCH_SIZE,
    cleanupMaxBatches: env.IDEMPOTENCY_CLEANUP_MAX_BATCHES,
  }),
  retentionMs: IDEMPOTENCY_RETENTION_MS,
  cleanupIntervalMs: IDEMPOTENCY_CLEANUP_INTERVAL_MS,
});
