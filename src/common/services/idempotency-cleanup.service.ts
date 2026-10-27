import { IdempotencyRepository } from '@/database/repositories/idempotency.repo';
import { idempotencyPolicy } from '@/config/idempotency.config';
import {
  IdempotencyPolicySchema,
  IDEMPOTENCY_CLEANUP_INTERVAL_MS,
} from '@/common/library/models/idempotency-policy.model';
import { logger } from '@/config/logger.config';

type CleanupPolicy = Pick<
  typeof idempotencyPolicy,
  'cleanupBatchSize' | 'cleanupMaxBatches'
>;

/** Per-process scheduling; concurrent instances safely recheck expiry in SQL. */
export class IdempotencyCleanupService {
  private timer?: NodeJS.Timeout;
  private pending?: Promise<void>;
  private accepting = false;
  private readonly policy: CleanupPolicy;

  public constructor(
    private readonly repository: Pick<
      IdempotencyRepository,
      'purgeExpiredBatch'
    > = new IdempotencyRepository(),
    policy: CleanupPolicy = idempotencyPolicy,
  ) {
    this.policy = IdempotencyPolicySchema.parse(policy);
  }

  public start(): void {
    if (this.accepting) return;
    this.accepting = true;
    this.timer = setInterval(() => {
      if (this.pending) return;
      void this.sweep().catch((error) =>
        logger.error({ error }, 'Idempotency response cleanup failed.'),
      );
    }, IDEMPOTENCY_CLEANUP_INTERVAL_MS);
    this.timer.unref();
  }

  public quiesce(): void {
    this.accepting = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  public stop(): Promise<void> {
    this.quiesce();

    return this.pending ?? Promise.resolve();
  }

  /** Shares in-flight work instead of overlapping; quiescing stops subsequent batches. */
  public sweep(): Promise<void> {
    if (this.pending) return this.pending;
    if (!this.accepting) return Promise.resolve();
    this.pending = this.runSweep().finally(() => {
      this.pending = undefined;
    });

    return this.pending;
  }

  private async runSweep(): Promise<void> {
    for (
      let batch = 0;
      batch < this.policy.cleanupMaxBatches && this.accepting;
      batch++
    ) {
      const count = await this.repository.purgeExpiredBatch(
        this.policy.cleanupBatchSize,
      );

      if (count < this.policy.cleanupBatchSize) return;
    }
  }
}
