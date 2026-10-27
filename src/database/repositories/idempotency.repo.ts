import { DataSource, type EntityManager, type QueryRunner } from 'typeorm';
import { AppDataSource } from '@/config/database.config';
import { IdempotencyEntity } from '../entities/idempotency.entity';
import {
  IdempotencyClaimSchema,
  IdempotencyHashSchema,
  type IdempotencyClaim,
  type PreparedJsonResponse,
} from '@/common/library/models/idempotency.model';
import {
  IDEMPOTENCY_RETENTION_MS,
  defaultIdempotencyPolicy,
} from '@/common/library/models/idempotency-policy.model';
import { validatePreparedResponse } from '@/common/helpers/idempotency.helper';

export interface IdempotencyLookup {
  record: IdempotencyEntity;
  unexpired: boolean;
}

/** Storage primitives only. Caller owns the key lock and transaction lifecycle. */
export class IdempotencyRepository {
  public constructor(private readonly source: DataSource = AppDataSource) {}

  public createQueryRunner(): QueryRunner {
    return this.source.createQueryRunner();
  }

  public async findByScope(
    manager: EntityManager,
    scopeHash: string,
  ): Promise<IdempotencyLookup | null> {
    IdempotencyHashSchema.parse(scopeHash);
    const { entities, raw } = await manager
      .getRepository(IdempotencyEntity)
      .createQueryBuilder('record')
      .addSelect(
        "CASE WHEN record.state = 'completed' AND record.expires_at > UTC_TIMESTAMP(3) THEN 1 ELSE 0 END",
        'unexpired',
      )
      .where('record.scope_hash = :scopeHash', { scopeHash })
      .getRawAndEntities();

    return entities[0]
      ? { record: entities[0], unexpired: Number(raw[0].unexpired) === 1 }
      : null;
  }

  public async insertClaim(
    manager: EntityManager,
    claim: IdempotencyClaim,
  ): Promise<void> {
    this.requireTransaction(manager);
    const accepted = IdempotencyClaimSchema.parse(claim);

    await manager.insert(IdempotencyEntity, {
      scope_hash: accepted.scopeHash,
      fingerprint: accepted.fingerprint,
      namespace: accepted.scope.namespace,
      caller_scope: accepted.scope.callerScope,
      operation: accepted.scope.operation,
      route: accepted.scope.route,
      state: 'processing',
      response_status: null,
      response_json: null,
      completed_at: null,
      expires_at: null,
    });
  }

  public async complete(
    manager: EntityManager,
    scopeHash: string,
    response: PreparedJsonResponse,
    maxResponseBytes: number = defaultIdempotencyPolicy.maxResponseBytes,
  ): Promise<void> {
    this.requireTransaction(manager);
    IdempotencyHashSchema.parse(scopeHash);
    const accepted = validatePreparedResponse(response, maxResponseBytes);
    const result = await manager
      .createQueryBuilder()
      .update(IdempotencyEntity)
      .set({
        state: 'completed',
        response_status: accepted.status,
        response_json: accepted.json ?? null,
        completed_at: () => 'UTC_TIMESTAMP(3)',
        expires_at: () =>
          'TIMESTAMPADD(SECOND, :retentionSeconds, UTC_TIMESTAMP(3))',
      })
      .where('scope_hash = :scopeHash AND state = :state', {
        scopeHash,
        state: 'processing',
      })
      .setParameter('retentionSeconds', IDEMPOTENCY_RETENTION_MS / 1000)
      .execute();

    if (result.affected !== 1)
      throw new Error('Only an existing processing claim can be completed.');
  }

  public async deleteExpired(
    manager: EntityManager,
    scopeHash: string,
  ): Promise<boolean> {
    this.requireTransaction(manager);
    IdempotencyHashSchema.parse(scopeHash);
    const result = await manager
      .createQueryBuilder()
      .delete()
      .from(IdempotencyEntity)
      .where(
        "scope_hash = :scopeHash AND state = 'completed' AND expires_at <= UTC_TIMESTAMP(3)",
        { scopeHash },
      )
      .execute();

    return result.affected === 1;
  }

  private requireTransaction(manager: EntityManager): void {
    if (!manager.queryRunner?.isTransactionActive)
      throw new Error(
        'Idempotency writes require an active transaction manager.',
      );
  }
}
