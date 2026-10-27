import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppDataSource } from '@/config/database.config';
import { IdempotencyRepository } from '@/database/repositories/idempotency.repo';
import { itemRepository } from '@/database/repositories/item.repo';
import {
  idempotencyScopeHash,
  requestFingerprint,
} from '@/common/helpers/idempotency.helper';
import type { PreparedJsonResponse } from '@/common/library/models/idempotency.model';
import {
  connectTestDatabase,
  disconnectTestDatabase,
  resetTestDatabase,
} from '../helpers/database/database';

const repository = new IdempotencyRepository();
const scope = {
  namespace: 'express:test',
  callerScope: 'public',
  operation: 'items.create',
  route: 'POST /api/v1/items',
};
function claim(key = 'opaque-key') {
  return {
    scope,
    scopeHash: idempotencyScopeHash(scope, key),
    fingerprint: requestFingerprint({ body: { name: 'Item', price: 12.5 } }),
  };
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
async function completed(
  key = 'opaque-key',
  response: PreparedJsonResponse = {
    status: 201,
    json: '{"name":"Original","price":12.5}',
  },
) {
  const input = claim(key);
  await AppDataSource.manager.transaction(async (manager) => {
    await repository.insertClaim(manager, input);
    await repository.complete(manager, input.scopeHash, response);
  });
  return input;
}

beforeAll(connectTestDatabase);
beforeEach(resetTestDatabase);
afterAll(disconnectTestDatabase);

describe('shared replay storage with real MySQL (no HTTP opt-in)', () => {
  it('stores only hashed key identity and exact response JSON with database-clock expiry', async () => {
    const key = 'raw-secret-key';
    const json = '{ "name": "é", "price": 12.50, "nested": [1, null] }';
    const input = await completed(key, { status: 201, json });
    const lookup = await repository.findByScope(
      AppDataSource.manager,
      input.scopeHash,
    );
    expect(lookup?.unexpired).toBe(true);
    expect(lookup?.record).toMatchObject({
      state: 'completed',
      response_status: 201,
      response_json: json,
      fingerprint: input.fingerprint,
      caller_scope: 'public',
    });
    expect(JSON.stringify(lookup)).not.toContain(key);
    const [clock] = await AppDataSource.query(
      'SELECT TIMESTAMPDIFF(SECOND, completed_at, expires_at) AS retention, completed_at <= UTC_TIMESTAMP(3) AS completed, expires_at > UTC_TIMESTAMP(3) AS active FROM request_idempotency',
    );
    expect({
      retention: Number(clock.retention),
      completed: Number(clock.completed),
      active: Number(clock.active),
    }).toEqual({ retention: 86400, completed: 1, active: 1 });
  });

  it('enforces unique claims without overwriting the original completed result', async () => {
    const input = await completed();
    const before = await repository.findByScope(
      AppDataSource.manager,
      input.scopeHash,
    );
    await expect(
      AppDataSource.manager.transaction((manager) =>
        repository.insertClaim(manager, input),
      ),
    ).rejects.toMatchObject({ driverError: { code: 'ER_DUP_ENTRY' } });
    expect(
      await repository.findByScope(AppDataSource.manager, input.scopeHash),
    ).toEqual(before);
    expect(await counts()).toEqual({ items: 0, replays: 1 });
  });

  it('rolls back item and completed response together after a later failure', async () => {
    const input = claim();
    await expect(
      AppDataSource.manager.transaction(async (manager) => {
        await repository.insertClaim(manager, input);
        await itemRepository.create({ name: 'Rollback', price: 1 }, manager);
        await repository.complete(manager, input.scopeHash, {
          status: 201,
          json: '{}',
        });
        throw new Error('Later failure');
      }),
    ).rejects.toThrow('Later failure');
    expect(await counts()).toEqual({ items: 0, replays: 0 });
    await completed('recovered');
    expect(await counts()).toEqual({ items: 0, replays: 1 });
  });

  it.each([
    { status: 500, json: '{}' },
    { status: 201, json: 'invalid' },
    { status: 201 },
    { status: 204, json: '{}' },
    { status: 201, json: JSON.stringify('é'.repeat(32768)) },
  ])(
    'rolls back claims and items on invalid/oversized completion %#',
    async (response) => {
      const input = claim();
      await expect(
        AppDataSource.manager.transaction(async (manager) => {
          await repository.insertClaim(manager, input);
          await itemRepository.create({ name: 'Rollback', price: 1 }, manager);
          await repository.complete(manager, input.scopeHash, response);
        }),
      ).rejects.toThrow();
      expect(await counts()).toEqual({ items: 0, replays: 0 });
    },
  );

  it('honors a lower configured response bound without truncating data', async () => {
    const input = claim();
    await expect(
      AppDataSource.manager.transaction(async (manager) => {
        await repository.insertClaim(manager, input);
        await repository.complete(
          manager,
          input.scopeHash,
          { status: 201, json: 'null' },
          3,
        );
      }),
    ).rejects.toThrow('storage limit');
    expect(await counts()).toEqual({ items: 0, replays: 0 });
  });

  it('persists a full 64 KiB UTF-8 response without reserialization', async () => {
    const json = JSON.stringify('é'.repeat(32767));
    const input = await completed('boundary', { status: 201, json });
    expect(
      (await repository.findByScope(AppDataSource.manager, input.scopeHash))
        ?.record.response_json,
    ).toBe(json);
    const [row] = await AppDataSource.query(
      'SELECT OCTET_LENGTH(response_json) AS bytes FROM request_idempotency',
    );
    expect(Number(row.bytes)).toBe(65536);
  });

  it('requires an active manager for writes and never updates completed retention', async () => {
    const input = await completed();
    await expect(
      repository.insertClaim(AppDataSource.manager, claim('outside')),
    ).rejects.toThrow('active transaction');
    await expect(
      repository.complete(AppDataSource.manager, input.scopeHash, {
        status: 201,
        json: '{}',
      }),
    ).rejects.toThrow('active transaction');
    await expect(
      repository.deleteExpired(AppDataSource.manager, input.scopeHash),
    ).rejects.toThrow('active transaction');
    const before = await repository.findByScope(
      AppDataSource.manager,
      input.scopeHash,
    );
    await expect(
      AppDataSource.manager.transaction((manager) =>
        repository.complete(manager, input.scopeHash, {
          status: 201,
          json: '{}',
        }),
      ),
    ).rejects.toThrow('processing claim');
    expect(
      await repository.findByScope(AppDataSource.manager, input.scopeHash),
    ).toEqual(before);
  });

  it('uses logical expiry even before deletion and only deletes expired completed rows', async () => {
    const input = await completed();
    expect(
      await AppDataSource.manager.transaction((manager) =>
        repository.deleteExpired(manager, input.scopeHash),
      ),
    ).toBe(false);
    await AppDataSource.query(
      'UPDATE request_idempotency SET expires_at = UTC_TIMESTAMP(3) WHERE scope_hash = ?',
      [input.scopeHash],
    );
    expect(
      (await repository.findByScope(AppDataSource.manager, input.scopeHash))
        ?.unexpired,
    ).toBe(false);
    expect(await counts()).toEqual({ items: 0, replays: 1 });
    expect(
      await AppDataSource.manager.transaction((manager) =>
        repository.deleteExpired(manager, input.scopeHash),
      ),
    ).toBe(true);
    expect(
      await repository.findByScope(AppDataSource.manager, input.scopeHash),
    ).toBeNull();
    await completed();
    expect(
      (await repository.findByScope(AppDataSource.manager, input.scopeHash))
        ?.unexpired,
    ).toBe(true);
  });

  it('keeps processing claims transaction-local and preserves bodyless outcomes', async () => {
    const runner = repository.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    const input = claim();
    try {
      await repository.insertClaim(runner.manager, input);
      const lookup = await repository.findByScope(
        runner.manager,
        input.scopeHash,
      );
      expect(lookup).toMatchObject({
        unexpired: false,
        record: { state: 'processing', completed_at: null, expires_at: null },
      });
      expect(
        await repository.findByScope(AppDataSource.manager, input.scopeHash),
      ).toBeNull();
      expect(
        await repository.deleteExpired(runner.manager, input.scopeHash),
      ).toBe(false);
      await runner.rollbackTransaction();
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
    }
    expect(await counts()).toEqual({ items: 0, replays: 0 });
    await completed('bodyless', { status: 204 });
    const result = await repository.findByScope(
      AppDataSource.manager,
      claim('bodyless').scopeHash,
    );
    expect(result?.record).toMatchObject({
      response_status: 204,
      response_json: null,
    });
  });

  it('rolls back earlier item writes when replay persistence fails', async () => {
    const input = await completed();
    await expect(
      AppDataSource.manager.transaction(async (manager) => {
        await itemRepository.create(
          { name: 'Must not persist', price: 1 },
          manager,
        );
        await repository.insertClaim(manager, input);
      }),
    ).rejects.toMatchObject({ driverError: { code: 'ER_DUP_ENTRY' } });
    expect(await counts()).toEqual({ items: 0, replays: 1 });
  });
});
