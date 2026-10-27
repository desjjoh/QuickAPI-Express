import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { AppDataSource } from '@/config/database.config';
import { IdempotencyRepository } from '@/database/repositories/idempotency.repo';
import { IdempotencyService } from '@/common/services/idempotency.service';
import { IdempotencyCleanupService } from '@/common/services/idempotency-cleanup.service';
import {
  idempotencyScopeHash,
  requestFingerprint,
} from '@/common/helpers/idempotency.helper';
import {
  connectTestDatabase,
  disconnectTestDatabase,
  resetTestDatabase,
} from '../helpers/database/database';
import { deferred } from '../helpers/http';
import { itemService } from '@/api/v1/items/services/items.service';
import { toItemDTO } from '@/api/v1/items/models/item.model';

const scope = {
  namespace: 'cleanup-tests',
  callerScope: 'public',
  operation: 'create',
  route: 'POST /test',
};
const fingerprint = requestFingerprint({ body: {} });
const repository = new IdempotencyRepository();
async function completed(key: string, expired = true) {
  const hash = idempotencyScopeHash(scope, key);
  await AppDataSource.manager.transaction(async (manager) => {
    await repository.insertClaim(manager, {
      scope,
      scopeHash: hash,
      fingerprint,
    });
    await repository.complete(manager, hash, { status: 204 });
  });
  if (expired)
    await AppDataSource.query(
      'UPDATE request_idempotency SET expires_at = UTC_TIMESTAMP(3) WHERE scope_hash = ?',
      [hash],
    );
  return hash;
}
async function count() {
  const [row] = await AppDataSource.query(
    'SELECT COUNT(*) AS count FROM request_idempotency',
  );
  return Number(row.count);
}
beforeAll(connectTestDatabase);
beforeEach(resetTestDatabase);
afterAll(disconnectTestDatabase);

describe('bounded cleanup with disposable MySQL', () => {
  it('rolls back mutation and claim after a real pinned-session disconnect, then recovers', async () => {
    const runner = repository.createQueryRunner();
    const runnerSpy = vi
      .spyOn(repository, 'createQueryRunner')
      .mockReturnValueOnce(runner);
    const started = deferred<number>();
    const finish = deferred();
    const service = new IdempotencyService(repository);
    const pending = service.execute(
      scope,
      'disconnect',
      fingerprint,
      async () => {
        const item = await itemService.create({
          body: { name: 'Interrupted', price: 2 },
        });
        const [connection] = await runner.query('SELECT CONNECTION_ID() AS id');
        started.resolve(Number(connection.id));
        await finish.promise;
        return { status: 201, json: JSON.stringify(toItemDTO(item)) };
      },
    );
    const outcome = pending.then(
      () => false,
      () => true,
    );
    try {
      const connectionId = await started.promise;
      if (!Number.isSafeInteger(connectionId))
        throw new Error('Invalid connection fixture ID.');
      await AppDataSource.query(`KILL CONNECTION ${connectionId}`);
      finish.resolve();
      expect(await outcome).toBe(true);
      expect(await count()).toBe(0);
      const [items] = await AppDataSource.query(
        'SELECT COUNT(*) AS count FROM items',
      );
      expect(Number(items.count)).toBe(0);
      await service.execute(scope, 'disconnect', fingerprint, async () => {
        const item = await itemService.create({
          body: { name: 'Recovered', price: 2 },
        });
        return { status: 201, json: JSON.stringify(toItemDTO(item)) };
      });
      expect(await count()).toBe(1);
    } finally {
      finish.resolve();
      runnerSpy.mockRestore();
      await outcome;
    }
  });
  it('deletes at most the configured rows, preserves live/processing records and allows a later sweep', async () => {
    for (let i = 0; i < 7; i++) await completed(`expired-${i}`);
    await completed('live', false);
    await AppDataSource.manager.transaction((manager) =>
      repository.insertClaim(manager, {
        scope,
        scopeHash: idempotencyScopeHash(scope, 'processing'),
        fingerprint,
      }),
    );
    const cleanup = new IdempotencyCleanupService(repository, {
      cleanupBatchSize: 2,
      cleanupMaxBatches: 2,
    });
    cleanup.start();
    try {
      await cleanup.sweep();
      expect(await count()).toBe(5);
      await cleanup.sweep();
      expect(await count()).toBe(2);
      expect(
        await repository.findByScope(
          AppDataSource.manager,
          idempotencyScopeHash(scope, 'live'),
        ),
      ).toHaveProperty('unexpired', true);
      expect(
        await repository.findByScope(
          AppDataSource.manager,
          idempotencyScopeHash(scope, 'processing'),
        ),
      ).toHaveProperty('record.state', 'processing');
      await expect(repository.purgeExpiredBatch(0)).rejects.toThrow();
    } finally {
      await cleanup.stop();
    }
  });

  it('coordinates simultaneous sweepers without deleting live responses or leaking connections', async () => {
    for (let i = 0; i < 9; i++) await completed(`expired-${i}`);
    await completed('live', false);
    const cleanups = [
      new IdempotencyCleanupService(repository),
      new IdempotencyCleanupService(repository),
    ];
    cleanups.forEach((cleanup) => cleanup.start());
    try {
      await Promise.all(cleanups.map((cleanup) => cleanup.sweep()));
      expect(await count()).toBe(1);
      await AppDataSource.query('SELECT 1');
    } finally {
      await Promise.all(cleanups.map((cleanup) => cleanup.stop()));
    }
  });

  it('rechecks expiry after waiting for an in-flight expired-key replacement', async () => {
    const hash = await completed('race');
    const started = deferred();
    const finish = deferred();
    const service = new IdempotencyService(repository);
    const pending = service.execute(scope, 'race', fingerprint, async () => {
      started.resolve();
      await finish.promise;
      return { status: 204 };
    });
    await started.promise;
    const runner = repository.createQueryRunner();
    const query = runner.query.bind(runner);
    const accepted = deferred();
    const spy = vi
      .spyOn(AppDataSource, 'query')
      .mockImplementationOnce(async (sql, params) => {
        const result = query(sql, params);
        accepted.resolve();
        return result;
      });
    const deleting = repository.purgeExpiredBatch(100);
    try {
      await accepted.promise;
      finish.resolve();
      await pending;
      expect(await deleting).toBe(0);
      expect(
        await repository.findByScope(AppDataSource.manager, hash),
      ).toHaveProperty('unexpired', true);
    } finally {
      finish.resolve();
      spy.mockRestore();
      await runner.release();
      await pending.catch(() => undefined);
      await deleting.catch(() => undefined);
    }
  });

  it('recovers from cleanup failure without changing expiry or disabling replay', async () => {
    const hash = await completed('live', false);
    await completed('expired');
    const before = await repository.findByScope(AppDataSource.manager, hash);
    const fault = vi
      .spyOn(repository, 'purgeExpiredBatch')
      .mockRejectedValueOnce(new Error('cleanup unavailable'));
    const cleanup = new IdempotencyCleanupService(repository);
    cleanup.start();
    try {
      await expect(cleanup.sweep()).rejects.toThrow('cleanup unavailable');
      await expect(
        new IdempotencyService(repository).execute(
          scope,
          'live',
          fingerprint,
          async () => {
            throw new Error('must not execute');
          },
        ),
      ).resolves.toEqual({ status: 204 });
      expect(await repository.findByScope(AppDataSource.manager, hash)).toEqual(
        before,
      );
      await cleanup.sweep();
      expect(await count()).toBe(1);
    } finally {
      fault.mockRestore();
      await cleanup.stop();
    }
  });
});
