import type { QueryRunner } from 'typeorm';
import { IdempotencyRepository } from '@/database/repositories/idempotency.repo';
import { idempotencyPolicy } from '@/config/idempotency.config';
import { logger } from '@/config/logger.config';
import { ConflictError } from '@/common/exceptions/http.exception';
import {
  hasApplicationTransaction,
  runInTransaction,
} from '@/common/helpers/transaction.helper';
import { assertRequestActive } from '@/common/helpers/request-context.helper';
import {
  idempotencyScopeHash,
  validatePreparedResponse,
} from '@/common/helpers/idempotency.helper';
import {
  IdempotencyHashSchema,
  type IdempotencyScope,
  type PreparedJsonResponse,
} from '@/common/library/models/idempotency.model';
import { IdempotencyPolicySchema } from '@/common/library/models/idempotency-policy.model';

type Connection = { destroy: () => void };

/** One pinned session owns the key lock, outer transaction, and prepared result. */
export class IdempotencyService {
  private readonly maxResponseBytes: number;

  public constructor(
    private readonly repository: IdempotencyRepository = new IdempotencyRepository(),
    policy: Pick<
      typeof idempotencyPolicy,
      'maxResponseBytes'
    > = idempotencyPolicy,
  ) {
    this.maxResponseBytes =
      IdempotencyPolicySchema.shape.maxResponseBytes.parse(
        policy.maxResponseBytes,
      );
  }

  public async execute(
    scope: IdempotencyScope,
    key: string,
    fingerprint: string,
    work: () => Promise<PreparedJsonResponse>,
  ): Promise<PreparedJsonResponse> {
    if (hasApplicationTransaction())
      throw new Error('Idempotent execution must own the outer transaction.');

    assertRequestActive();
    const scopeHash = idempotencyScopeHash(scope, key);

    IdempotencyHashSchema.parse(fingerprint);
    const runner = this.repository.createQueryRunner();
    let connection: Connection | undefined;
    let locked = false;
    let uncertain = false;
    let failed = false;

    try {
      connection = await runner.connect();
      assertRequestActive();
      // Even a failed acknowledgement can follow successful server acquisition.
      uncertain = true;
      const locks = await runner.query('SELECT GET_LOCK(?, 0) AS acquired', [
        scopeHash,
      ]);
      const acquired: unknown = locks[0]?.acquired;

      if (acquired === 0 || acquired === '0') {
        uncertain = false;

        throw new ConflictError(
          'This idempotent request is already processing.',
        );
      }

      if (acquired !== 1 && acquired !== '1')
        throw new Error('Unable to establish idempotency lock ownership.');

      locked = true;
      uncertain = false;

      return await runInTransaction(runner.manager, async (manager) => {
        const existing = await this.repository.findByScope(manager, scopeHash);

        if (existing) {
          if (existing.record.state !== 'completed')
            throw new Error('Unexpected persisted idempotency claim state.');
          if (existing.unexpired) {
            if (existing.record.fingerprint !== fingerprint)
              throw new ConflictError(
                'Idempotency-Key was already used with a different payload.',
              );

            // A lowered deployment limit applies to new results, not old replays.
            return validatePreparedResponse({
              status: existing.record.response_status!,
              json: existing.record.response_json ?? undefined,
            });
          }

          await this.repository.deleteExpired(manager, scopeHash);
        }

        await this.repository.insertClaim(manager, {
          scope,
          scopeHash,
          fingerprint,
        });
        assertRequestActive();
        const response = validatePreparedResponse(
          await work(),
          this.maxResponseBytes,
        );

        await this.repository.complete(
          manager,
          scopeHash,
          response,
          this.maxResponseBytes,
        );

        return response;
      });
    } catch (error) {
      failed = true;

      throw error;
    } finally {
      await this.releaseSession(
        runner,
        connection,
        scopeHash,
        locked,
        uncertain,
        failed,
      );
    }
  }

  private async releaseSession(
    runner: QueryRunner,
    connection: Connection | undefined,
    scopeHash: string,
    locked: boolean,
    uncertain: boolean,
    failed: boolean,
  ): Promise<void> {
    let cleanupError: unknown;

    // Never race cleanup against accepted SQL; all awaited work has settled here.
    if (runner.isTransactionActive) uncertain = true;
    if (locked && !uncertain) {
      try {
        const released = await runner.query(
          'SELECT RELEASE_LOCK(?) AS released',
          [scopeHash],
        );

        if (released[0]?.released !== 1 && released[0]?.released !== '1')
          throw new Error('Unable to confirm idempotency lock release.');
      } catch (error) {
        uncertain = true;
        cleanupError = error;
      }
    }

    try {
      if (uncertain) {
        // A destroyed mysql2 session cannot return a lock or transaction to the pool.
        connection?.destroy();
        logger.error('Discarded an uncertain idempotency database session.');
      }

      await runner.release();
    } catch (error) {
      connection?.destroy();
      cleanupError ??= error;
    }

    if (cleanupError) {
      if (!failed) throw cleanupError;
      logger.error(
        { error: cleanupError },
        'Idempotency cleanup failed after execution failure.',
      );
    }
  }
}
