import { DataSource } from 'typeorm';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { AppDataSource } from '@/config/database.config';
import { databaseTransportOptions } from '@/config/database-options.config';
import { env } from '@/config/env.config';
import { IdempotencyService } from '@/common/services/idempotency.service';
import { IdempotencyRepository } from '@/database/repositories/idempotency.repo';
import { itemRepository } from '@/database/repositories/item.repo';
import { itemService } from '@/api/v1/items/services/items.service';
import { toItemDTO } from '@/api/v1/items/models/item.model';
import {
  idempotencyScopeHash,
  requestFingerprint,
} from '@/common/helpers/idempotency.helper';
import { runInTransaction } from '@/common/helpers/transaction.helper';
import {
  RequestContext,
  runWithRequestContext,
} from '@/common/helpers/request-context.helper';
import {
  connectTestDatabase,
  disconnectTestDatabase,
  resetTestDatabase,
} from '../helpers/database/database';
import { deferred } from '../helpers/http';

const scope = {
  namespace: 'express:integration',
  callerScope: 'public',
  operation: 'items.create',
  route: 'POST /api/v1/items',
};
const fingerprint = requestFingerprint({
  body: { name: 'Original', price: 12.5 },
});
const key = 'execution-key';
const hash = idempotencyScopeHash(scope, key);
const sources: DataSource[] = [];

async function isolatedSource(): Promise<DataSource> {
  const options = AppDataSource.options;
  if (options.type !== 'mysql')
    throw new Error('MySQL integration requires MySQL.');
  const source = new DataSource({
    ...options,
    ...databaseTransportOptions({
      ...env,
      DB_POOL_CONNECTION_LIMIT: 1,
      DB_POOL_QUEUE_LIMIT: 1,
      DB_POOL_ACQUIRE_TIMEOUT_MS: 200,
    }),
  });
  sources.push(source);
  await source.initialize();
  return source;
}
async function create() {
  const item = await itemService.create({
    body: { name: 'Original', price: 12.5 },
  });
  return { status: 201, json: JSON.stringify(toItemDTO(item)) };
}
async function counts() {
  const [items] = await AppDataSource.query(
    'SELECT COUNT(*) AS count FROM items',
  );
  const [replays] = await AppDataSource.query(
    'SELECT COUNT(*) AS count FROM request_idempotency',
  );
  return { items: Number(items.count), replays: Number(replays.count) };
}
async function expectUnlocked(scopeHash = hash) {
  // Socket destruction frees the server session asynchronously across connections.
  await expect
    .poll(
      async () => {
        const [row] = await AppDataSource.query(
          'SELECT IS_FREE_LOCK(?) AS free',
          [scopeHash],
        );
        return Number(row.free);
      },
      { timeout: 1000, interval: 10 },
    )
    .toBe(1);
}
beforeAll(connectTestDatabase);
beforeEach(resetTestDatabase);
afterEach(async () => {
  vi.restoreAllMocks();
  for (const source of sources.splice(0))
    if (source.isInitialized) await source.destroy();
});
afterAll(disconnectTestDatabase);

describe('coordinated replay execution with real MySQL (no HTTP opt-in)', () => {
  it('discards a session after real rollback failure and frees its single pool slot', async () => {
    const source = await isolatedSource();
    const repository = new IdempotencyRepository(source);
    const runner = repository.createQueryRunner();
    vi.spyOn(repository, 'createQueryRunner').mockReturnValueOnce(runner);
    vi.spyOn(runner, 'rollbackTransaction').mockRejectedValueOnce(
      new Error('rollback acknowledgement failed'),
    );
    const service = new IdempotencyService(repository);
    await expect(
      service.execute(scope, key, fingerprint, () =>
        runInTransaction(source.manager, async (manager) => {
          await itemRepository.create(
            { name: 'Never committed', price: 1 },
            manager,
          );
          throw new Error('original work failed');
        }),
      ),
    ).rejects.toThrow('original work failed');
    await expectUnlocked();
    // A new transaction must be able to reuse the single-slot pool after disposal.
    await service.execute(scope, key, fingerprint, async () => ({
      status: 204,
    }));
    expect(await counts()).toEqual({ items: 0, replays: 1 });
    await expectUnlocked();
  });

  it('awaits an accepted SQL statement after disconnect before rolling back and releasing', async () => {
    const holder = AppDataSource.createQueryRunner();
    await holder.connect();
    const sqlLock = 'idempotency-test-pending-sql';
    await holder.query('SELECT GET_LOCK(?, 0)', [sqlLock]);
    const repository = new IdempotencyRepository();
    const runner = repository.createQueryRunner();
    vi.spyOn(repository, 'createQueryRunner').mockReturnValueOnce(runner);
    const query = runner.query.bind(runner);
    const accepted = deferred();
    vi.spyOn(runner, 'query').mockImplementation(async (...args) => {
      const pending = query(...args);
      if (args[0].includes('IS_USED_LOCK')) accepted.resolve();
      return pending;
    });
    const released = vi.spyOn(runner, 'release');
    const context = new RequestContext();
    const service = new IdempotencyService(repository);
    const pending = runWithRequestContext(context, () =>
      service.execute(scope, key, fingerprint, async () => {
        const response = await create();
        // GET_LOCK blocks on another connection; the second expression marks this SQL.
        await runner.query(
          'SELECT GET_LOCK(?, 3) AS held, IS_USED_LOCK(?) AS owner',
          [sqlLock, sqlLock],
        );
        await runner.query('SELECT RELEASE_LOCK(?)', [sqlLock]);
        return response;
      }),
    );
    try {
      await accepted.promise;
      context.abandon();
      expect(released).not.toHaveBeenCalled();
      expect(runner.isTransactionActive).toBe(true);
      await holder.query('SELECT RELEASE_LOCK(?)', [sqlLock]);
      await expect(pending).rejects.toHaveProperty('status', 408);
      expect(await counts()).toEqual({ items: 0, replays: 0 });
      await expectUnlocked();
    } finally {
      await holder.query('SELECT RELEASE_LOCK(?)', [sqlLock]);
      await holder.release();
      await pending.catch(() => undefined);
    }
  });
  it('commits multiple service transactions and prepared response once, then replays exact original bytes', async () => {
    const repository = new IdempotencyRepository();
    const runner = repository.createQueryRunner();
    vi.spyOn(repository, 'createQueryRunner').mockReturnValueOnce(runner);
    const begin = vi.spyOn(runner, 'startTransaction');
    const commit = vi.spyOn(runner, 'commitTransaction');
    const service = new IdempotencyService(repository);
    const work = vi.fn(async () => {
      const first = await create();
      await itemService.create({
        body: { name: 'Second repo operation', price: 2 },
      });
      return first;
    });
    const original = await service.execute(scope, key, fingerprint, work);
    expect(begin).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(await counts()).toEqual({ items: 2, replays: 1 });
    await expect(
      service.execute(scope, key, fingerprint, work),
    ).resolves.toEqual(original);
    expect(work).toHaveBeenCalledTimes(1);
    await expect(
      service.execute(scope, key, '0'.repeat(64), work),
    ).rejects.toHaveProperty('status', 409);
    expect(await counts()).toEqual({ items: 2, replays: 1 });
    await expectUnlocked();
  });

  it('fences simultaneous matching and conflicting requests across separate pools without waiting for work', async () => {
    const other = await isolatedSource();
    const second = new IdempotencyService(new IdempotencyRepository(other));
    const started = deferred();
    const finish = deferred();
    const service = new IdempotencyService();
    const pending = service.execute(scope, key, fingerprint, async () => {
      const result = await create();
      started.resolve();
      await finish.promise;
      return result;
    });
    try {
      await started.promise;
      const duplicate = vi.fn(create);
      await expect(
        second.execute(scope, key, fingerprint, duplicate),
      ).rejects.toHaveProperty('status', 409);
      await expect(
        second.execute(scope, key, '0'.repeat(64), duplicate),
      ).rejects.toHaveProperty('status', 409);
      expect(duplicate).not.toHaveBeenCalled();
      expect(await counts()).toEqual({ items: 0, replays: 0 });
    } finally {
      finish.resolve();
    }
    const original = await pending;
    await expect(
      second.execute(scope, key, fingerprint, vi.fn(create)),
    ).resolves.toEqual(original);
    expect(await counts()).toEqual({ items: 1, replays: 1 });
  });

  it('does not serialize different keys or trusted scope namespaces', async () => {
    const started = deferred();
    const finish = deferred();
    const service = new IdempotencyService();
    const pending = service.execute(scope, key, fingerprint, async () => {
      started.resolve();
      await finish.promise;
      return { status: 204 };
    });
    try {
      await started.promise;
      await service.execute(scope, 'other-key', fingerprint, create);
      await service.execute(
        { ...scope, callerScope: 'other-scope' },
        key,
        fingerprint,
        create,
      );
    } finally {
      finish.resolve();
    }
    await pending;
    expect(await counts()).toEqual({ items: 2, replays: 3 });
  });

  it.each(['business', 'DTO', 'JSON', 'oversized', 'unsuccessful'] as const)(
    'rolls back item and claim on %s failure and allows a clean retry',
    async (fault) => {
      const service = new IdempotencyService();
      await expect(
        service.execute(scope, key, fingerprint, async () => {
          const result = await create();
          if (fault === 'business') throw new Error('business failure');
          if (fault === 'DTO')
            toItemDTO({ ...JSON.parse(result.json), name: '' });
          if (fault === 'JSON') JSON.stringify({ value: BigInt(1) });
          if (fault === 'oversized')
            return { status: 201, json: JSON.stringify('x'.repeat(65536)) };
          return { status: 400, json: '{}' };
        }),
      ).rejects.toThrow();
      expect(await counts()).toEqual({ items: 0, replays: 0 });
      await expectUnlocked();
      await service.execute(scope, key, fingerprint, create);
      expect(await counts()).toEqual({ items: 1, replays: 1 });
    },
  );

  it('rolls back earlier repository operations when a later real SQL statement fails', async () => {
    const service = new IdempotencyService();
    await expect(
      service.execute(scope, key, fingerprint, async () => {
        await create();
        await runInTransaction(AppDataSource.manager, async (manager) => {
          await manager.query(
            'INSERT INTO items (id, name, price, version) VALUES (?, ?, ?, ?)',
            ['invalid-version', 'bad', 1, null],
          );
        });
        return { status: 204 };
      }),
    ).rejects.toThrow();
    expect(await counts()).toEqual({ items: 0, replays: 0 });
    await expectUnlocked();
  });

  it('rolls back completed preparation when replay finalization fails', async () => {
    const repository = new IdempotencyRepository();
    vi.spyOn(repository, 'complete').mockRejectedValueOnce(
      new Error('replay storage unavailable'),
    );
    const service = new IdempotencyService(repository);
    await expect(
      service.execute(scope, key, fingerprint, create),
    ).rejects.toThrow('replay storage unavailable');
    expect(await counts()).toEqual({ items: 0, replays: 0 });
    await expectUnlocked();
    await service.execute(scope, key, fingerprint, create);
  });

  it('rolls back a failed commit before acknowledging success', async () => {
    const repository = new IdempotencyRepository();
    const runner = repository.createQueryRunner();
    vi.spyOn(repository, 'createQueryRunner').mockReturnValueOnce(runner);
    vi.spyOn(runner, 'commitTransaction').mockRejectedValueOnce(
      new Error('commit refused'),
    );
    const service = new IdempotencyService(repository);
    await expect(
      service.execute(scope, key, fingerprint, create),
    ).rejects.toThrow('commit refused');
    expect(await counts()).toEqual({ items: 0, replays: 0 });
    await expectUnlocked();
    await service.execute(scope, key, fingerprint, create);
  });

  it('replays a committed result after simulated lost commit acknowledgement instead of repeating work', async () => {
    const repository = new IdempotencyRepository();
    const runner = repository.createQueryRunner();
    const commit = runner.commitTransaction.bind(runner);
    vi.spyOn(repository, 'createQueryRunner').mockReturnValueOnce(runner);
    vi.spyOn(runner, 'commitTransaction').mockImplementationOnce(async () => {
      await commit();
      throw new Error('acknowledgement lost');
    });
    const service = new IdempotencyService(repository);
    const work = vi.fn(create);
    await expect(
      service.execute(scope, key, fingerprint, work),
    ).rejects.toThrow('acknowledgement lost');
    expect(await counts()).toEqual({ items: 1, replays: 1 });
    await service.execute(scope, key, fingerprint, work);
    expect(work).toHaveBeenCalledTimes(1);
    await expectUnlocked();
  });

  it('holds transaction and lock until abandoned work settles, then rolls back', async () => {
    const context = new RequestContext();
    const started = deferred();
    const finish = deferred();
    const repository = new IdempotencyRepository();
    const runner = repository.createQueryRunner();
    vi.spyOn(repository, 'createQueryRunner').mockReturnValueOnce(runner);
    const release = vi.spyOn(runner, 'release');
    const service = new IdempotencyService(repository);
    const pending = runWithRequestContext(context, () =>
      service.execute(scope, key, fingerprint, async () => {
        const result = await create();
        started.resolve();
        await finish.promise;
        return result;
      }),
    );
    await started.promise;
    context.abandon();
    expect(release).not.toHaveBeenCalled();
    const [row] = await AppDataSource.query('SELECT IS_FREE_LOCK(?) AS free', [
      hash,
    ]);
    expect(Number(row.free)).toBe(0);
    expect(await counts()).toEqual({ items: 0, replays: 0 });
    finish.resolve();
    await expect(pending).rejects.toHaveProperty('status', 408);
    expect(await counts()).toEqual({ items: 0, replays: 0 });
    await expectUnlocked();
    await service.execute(scope, key, fingerprint, create);
  });

  it('replaces an expired record atomically and preserves it when the replacement fails', async () => {
    const service = new IdempotencyService();
    const original = await service.execute(scope, key, fingerprint, create);
    await AppDataSource.query(
      'UPDATE request_idempotency SET expires_at = UTC_TIMESTAMP(3) WHERE scope_hash = ?',
      [hash],
    );
    const before = await AppDataSource.query(
      'SELECT * FROM request_idempotency',
    );
    await expect(
      service.execute(scope, key, '1'.repeat(64), async () => {
        await create();
        throw new Error('replacement failed');
      }),
    ).rejects.toThrow('replacement failed');
    expect(
      await AppDataSource.query('SELECT * FROM request_idempotency'),
    ).toEqual(before);
    const replacement = await service.execute(
      scope,
      key,
      '1'.repeat(64),
      create,
    );
    expect(replacement).not.toEqual(original);
    expect(await counts()).toEqual({ items: 2, replays: 1 });
  });

  it('replays original creation after later edits and deletion without extending retention', async () => {
    const service = new IdempotencyService();
    const original = await service.execute(scope, key, fingerprint, create);
    const item = JSON.parse(original.json!);
    const before = await AppDataSource.query(
      'SELECT * FROM request_idempotency',
    );
    await itemService.update({
      params: { id: item.id },
      body: { name: 'Changed', expected_version: 1 },
    });
    await itemService.remove({
      params: { id: item.id },
      body: { expected_version: 2 },
    });
    const work = vi.fn(create);
    await expect(
      service.execute(scope, key, fingerprint, work),
    ).resolves.toEqual(original);
    expect(work).not.toHaveBeenCalled();
    expect(await counts()).toEqual({ items: 0, replays: 1 });
    expect(
      await AppDataSource.query('SELECT * FROM request_idempotency'),
    ).toEqual(before);
  });

  it('discards a still-locked connection and reuses a single-slot pool after release failure', async () => {
    const source = await isolatedSource();
    const repository = new IdempotencyRepository(source);
    const runner = repository.createQueryRunner();
    const query = runner.query.bind(runner);
    vi.spyOn(repository, 'createQueryRunner').mockReturnValueOnce(runner);
    vi.spyOn(runner, 'query').mockImplementation(async (...args) => {
      if (args[0].includes('RELEASE_LOCK')) throw new Error('release failed');
      return query(...args);
    });
    const service = new IdempotencyService(repository);
    const work = vi.fn(() =>
      runInTransaction(source.manager, async (manager) => {
        const item = await itemRepository.create(
          { name: 'Pinned', price: 2 },
          manager,
        );
        return { status: 201, json: JSON.stringify(toItemDTO(item)) };
      }),
    );
    await expect(
      service.execute(scope, key, fingerprint, work),
    ).rejects.toThrow('release failed');
    await expectUnlocked();
    await expect(
      service.execute(scope, key, fingerprint, work),
    ).resolves.toHaveProperty('status', 201);
    expect(work).toHaveBeenCalledTimes(1);
    expect(await counts()).toEqual({ items: 1, replays: 1 });
    await expect(source.query('SELECT 1 AS usable')).resolves.toBeDefined();
  });

  it('releases a single-slot pool on repeated rollback and replay paths', async () => {
    const source = await isolatedSource();
    const service = new IdempotencyService(new IdempotencyRepository(source));
    for (let i = 0; i < 3; i++) {
      await expect(
        service.execute(scope, key, fingerprint, () =>
          runInTransaction(source.manager, async (manager) => {
            await itemRepository.create(
              { name: 'Rollback', price: 2 },
              manager,
            );
            throw new Error('later failure');
          }),
        ),
      ).rejects.toThrow('later failure');
      await expectUnlocked();
      await expect(source.query('SELECT 1 AS usable')).resolves.toBeDefined();
    }
    await service.execute(scope, key, fingerprint, async () => ({
      status: 204,
    }));
    await service.execute(scope, key, fingerprint, vi.fn());
    expect(await counts()).toEqual({ items: 0, replays: 1 });
  });
});
