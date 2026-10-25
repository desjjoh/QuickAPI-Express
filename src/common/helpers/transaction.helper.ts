import { AsyncLocalStorage } from 'node:async_hooks';
import type { EntityManager } from 'typeorm';
import { assertRequestActive } from './request-context.helper';

const transactions = new AsyncLocalStorage<EntityManager>();

/** Await work before rollback/release; request expiry cannot cancel running SQL. */
export async function runInTransaction<T>(
  manager: EntityManager,
  work: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  assertRequestActive();
  const outer = transactions.getStore();

  if (outer) {
    if (
      outer.connection !== manager.connection ||
      !outer.queryRunner?.isTransactionActive
    )
      throw new Error(
        'Reuse the active transaction manager from the same data source.',
      );

    return work(outer);
  }

  if (manager.queryRunner?.isTransactionActive)
    throw new Error('Start application transactions through runInTransaction.');

  return manager.transaction((transactionManager) =>
    transactions.run(transactionManager, async () => {
      // Pool acquisition may itself outlive the request.
      assertRequestActive();
      const result = await work(transactionManager);

      assertRequestActive();

      return result;
    }),
  );
}
