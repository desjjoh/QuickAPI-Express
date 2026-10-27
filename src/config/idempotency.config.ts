import { env } from './env.config';
import { createHash } from 'node:crypto';
import {
  IdempotencyPolicySchema,
  IDEMPOTENCY_RETENTION_MS,
  IDEMPOTENCY_CLEANUP_INTERVAL_MS,
} from '@/common/library/models/idempotency-policy.model';

/** Stable across replicas and host aliases; changing it changes the replay namespace. */
export const idempotencyNamespace = createHash('sha256')
  .update(JSON.stringify([env.APP_NAME, env.DB_DATABASE]))
  .digest('hex');

/** Shared validated policy; the application lifecycle owns the cleanup timer. */
export const idempotencyPolicy = Object.freeze({
  ...IdempotencyPolicySchema.parse({
    maxResponseBytes: env.IDEMPOTENCY_MAX_RESPONSE_BYTES,
    cleanupBatchSize: env.IDEMPOTENCY_CLEANUP_BATCH_SIZE,
    cleanupMaxBatches: env.IDEMPOTENCY_CLEANUP_MAX_BATCHES,
  }),
  retentionMs: IDEMPOTENCY_RETENTION_MS,
  cleanupIntervalMs: IDEMPOTENCY_CLEANUP_INTERVAL_MS,
});
