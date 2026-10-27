import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EntityManager } from 'typeorm';
import { IdempotencyService } from '@/common/services/idempotency.service';
import { IdempotencyRepository } from '@/database/repositories/idempotency.repo';
import { requestFingerprint } from '@/common/helpers/idempotency.helper';
import { runInTransaction } from '@/common/helpers/transaction.helper';
import {
  RequestContext,
  runWithRequestContext,
} from '@/common/helpers/request-context.helper';
import { deferred } from '../helpers/http';

const scope = {
  namespace: 'unit',
  callerScope: 'public',
  operation: 'create',
  route: 'POST /items',
};
const fingerprint = requestFingerprint({ body: { price: 1 } });
const response = { status: 201, json: '{ "price": 1 }' };

function fixture() {
  const events: string[] = [];
  const runner = {
    isTransactionActive: false,
    connect: vi.fn(async () => connection),
    release: vi.fn(async () => {
      events.push('release');
    }),
    query: vi.fn(async (sql: string) => {
      events.push(sql.includes('GET_LOCK') ? 'lock' : 'unlock');
      return sql.includes('GET_LOCK') ? [{ acquired: 1 }] : [{ released: 1 }];
    }),
    manager: {} as EntityManager,
  };
  const connection = {
    destroy: vi.fn(() => {
      events.push('destroy');
    }),
  };
  const commit = vi.fn(async () => {
    events.push('commit');
    runner.isTransactionActive = false;
  });
  const rollback = vi.fn(async () => {
    events.push('rollback');
    runner.isTransactionActive = false;
  });
  const manager = {
    connection: {},
    queryRunner: runner,
    transaction: vi.fn(
      async (work: (manager: EntityManager) => Promise<unknown>) => {
        runner.isTransactionActive = true;
        events.push('begin');
        try {
          const value = await work(manager as unknown as EntityManager);
          await commit();
          return value;
        } catch (error) {
          await rollback();
          throw error;
        }
      },
    ),
  };
  runner.manager = manager as unknown as EntityManager;
  const repository = {
    createQueryRunner: vi.fn(() => runner),
    findByScope: vi.fn(async (): Promise<unknown> => null),
    insertClaim: vi.fn(async () => {
      events.push('claim');
    }),
    complete: vi.fn(async () => {
      events.push('complete');
    }),
    deleteExpired: vi.fn(async () => true),
  };
  const service = new IdempotencyService(
    repository as unknown as IdempotencyRepository,
  );
  const work = vi.fn(async () => {
    events.push('work');
    return response;
  });
  return {
    service,
    repository,
    runner,
    connection,
    commit,
    rollback,
    events,
    work,
  };
}
afterEach(() => vi.restoreAllMocks());

describe('shared idempotency execution ownership', () => {
  it('validates keys, scopes and fingerprints before acquiring a connection', async () => {
    const f = fixture();
    await expect(
      f.service.execute(scope, 'bad key', fingerprint, f.work),
    ).rejects.toThrow();
    await expect(
      f.service.execute(
        { ...scope, namespace: '' },
        'key',
        fingerprint,
        f.work,
      ),
    ).rejects.toThrow();
    await expect(
      f.service.execute(scope, 'key', 'bad-hash', f.work),
    ).rejects.toThrow();
    expect(f.repository.createQueryRunner).not.toHaveBeenCalled();
  });

  it.each(['findByScope', 'insertClaim'] as const)(
    'does not run business work after %s failure',
    async (method) => {
      const f = fixture();
      f.repository[method].mockRejectedValueOnce(new Error('storage failed'));
      await expect(
        f.service.execute(scope, 'key', fingerprint, f.work),
      ).rejects.toThrow('storage failed');
      expect(f.work).not.toHaveBeenCalled();
      expect(f.rollback).toHaveBeenCalledOnce();
    },
  );

  it.each([
    { state: 'processing', fingerprint },
    {
      state: 'completed',
      fingerprint,
      response_status: 201,
      response_json: 'corrupt JSON',
    },
  ])(
    'fails closed for malformed persisted state without re-execution',
    async (record) => {
      const f = fixture();
      f.repository.findByScope.mockResolvedValueOnce({
        unexpired: true,
        record,
      });
      await expect(
        f.service.execute(scope, 'key', fingerprint, f.work),
      ).rejects.toThrow();
      expect(f.work).not.toHaveBeenCalled();
      expect(f.repository.insertClaim).not.toHaveBeenCalled();
    },
  );
  it('pins one manager and completes before commit, unlock and release', async () => {
    const f = fixture();
    await expect(
      f.service.execute(scope, 'key', fingerprint, f.work),
    ).resolves.toEqual(response);
    expect(f.events).toEqual([
      'lock',
      'begin',
      'claim',
      'work',
      'complete',
      'commit',
      'unlock',
      'release',
    ]);
    expect(f.repository.complete).toHaveBeenCalledWith(
      f.runner.manager,
      expect.any(String),
      response,
      65536,
    );
  });

  it('replays without work or TTL rewrite, preserving results after a limit reduction', async () => {
    const f = fixture();
    f.repository.findByScope.mockResolvedValue({
      unexpired: true,
      record: {
        state: 'completed',
        fingerprint,
        response_status: 201,
        response_json: response.json,
      },
    });
    const service = new IdempotencyService(
      f.repository as unknown as IdempotencyRepository,
      { maxResponseBytes: 1 },
    );
    await expect(
      service.execute(scope, 'key', fingerprint, f.work),
    ).resolves.toEqual(response);
    expect(f.work).not.toHaveBeenCalled();
    expect(f.repository.complete).not.toHaveBeenCalled();
    expect(f.repository.insertClaim).not.toHaveBeenCalled();
  });

  it('rejects fingerprint mismatch without changing a completed result', async () => {
    const f = fixture();
    f.repository.findByScope.mockResolvedValue({
      unexpired: true,
      record: { state: 'completed', fingerprint: '0'.repeat(64) },
    });
    await expect(
      f.service.execute(scope, 'key', fingerprint, f.work),
    ).rejects.toHaveProperty('status', 409);
    expect(f.work).not.toHaveBeenCalled();
    expect(f.rollback).toHaveBeenCalledOnce();
  });

  it.each([0, '0'])(
    'treats only definite contention %s as 409',
    async (value) => {
      const f = fixture();
      f.runner.query.mockResolvedValueOnce([{ acquired: value }] as never);
      await expect(
        f.service.execute(scope, 'key', fingerprint, f.work),
      ).rejects.toHaveProperty('status', 409);
      expect(f.runner.manager.transaction).not.toHaveBeenCalled();
      expect(f.connection.destroy).not.toHaveBeenCalled();
      expect(f.runner.release).toHaveBeenCalledOnce();
    },
  );

  it.each([null, undefined, 2, 'garbage'])(
    'fails closed and discards uncertain lock result %s',
    async (value) => {
      const f = fixture();
      f.runner.query.mockResolvedValueOnce([{ acquired: value }] as never);
      await expect(
        f.service.execute(scope, 'key', fingerprint, f.work),
      ).rejects.toThrow('lock ownership');
      expect(f.work).not.toHaveBeenCalled();
      expect(f.connection.destroy).toHaveBeenCalledOnce();
    },
  );

  it('discards a session after a failed lock acknowledgement', async () => {
    const f = fixture();
    f.runner.query.mockRejectedValueOnce(new Error('lost acknowledgement'));
    await expect(
      f.service.execute(scope, 'key', fingerprint, f.work),
    ).rejects.toThrow('lost acknowledgement');
    expect(f.connection.destroy).toHaveBeenCalledOnce();
  });

  it('preserves acquisition failures and releases the unused runner', async () => {
    const f = fixture();
    const error = Object.assign(new Error('capacity'), {
      code: 'DB_POOL_CAPACITY',
    });
    f.runner.connect.mockRejectedValueOnce(error);
    await expect(
      f.service.execute(scope, 'key', fingerprint, f.work),
    ).rejects.toBe(error);
    expect(f.runner.query).not.toHaveBeenCalled();
    expect(f.runner.release).toHaveBeenCalledOnce();
  });

  it.each(['work', 'complete', 'commit'] as const)(
    'rolls back and releases after %s failure',
    async (stage) => {
      const f = fixture();
      const fault = stage === 'complete' ? f.repository.complete : f[stage];
      fault.mockRejectedValueOnce(new Error('fault'));
      await expect(
        f.service.execute(scope, 'key', fingerprint, f.work),
      ).rejects.toThrow('fault');
      expect(f.events.slice(-3)).toEqual(['rollback', 'unlock', 'release']);
    },
  );

  it('waits for accepted work after abandonment before rolling back and unlocking', async () => {
    const f = fixture();
    const started = deferred();
    const finish = deferred();
    const context = new RequestContext();
    const pending = runWithRequestContext(context, () =>
      f.service.execute(scope, 'key', fingerprint, async () => {
        started.resolve();
        await finish.promise;
        return response;
      }),
    );
    await started.promise;
    context.abandon();
    expect(f.runner.release).not.toHaveBeenCalled();
    expect(f.rollback).not.toHaveBeenCalled();
    finish.resolve();
    await expect(pending).rejects.toHaveProperty('status', 408);
    expect(f.events.slice(-3)).toEqual(['rollback', 'unlock', 'release']);
  });

  it('does not acquire a lock after a delayed connection outlives the request', async () => {
    const f = fixture();
    const connected = deferred<typeof f.connection>();
    f.runner.connect.mockReturnValueOnce(connected.promise);
    const context = new RequestContext();
    const pending = runWithRequestContext(context, () =>
      f.service.execute(scope, 'key', fingerprint, f.work),
    );
    context.abandon();
    connected.resolve(f.connection);
    await expect(pending).rejects.toHaveProperty('status', 408);
    expect(f.runner.query).not.toHaveBeenCalled();
    expect(f.runner.release).toHaveBeenCalledOnce();
  });

  it('rejects nesting before obtaining another connection', async () => {
    const f = fixture();
    await runInTransaction(f.runner.manager, async () => {
      await expect(
        f.service.execute(scope, 'key', fingerprint, f.work),
      ).rejects.toThrow('outer transaction');
    });
    expect(f.runner.connect).not.toHaveBeenCalled();
  });

  it.each([null, 0])(
    'discards sessions on an unconfirmed release %s and reports failure after commit',
    async (value) => {
      const f = fixture();
      f.runner.query
        .mockResolvedValueOnce([{ acquired: 1 }])
        .mockResolvedValueOnce([{ released: value }] as never);
      await expect(
        f.service.execute(scope, 'key', fingerprint, f.work),
      ).rejects.toThrow('lock release');
      expect(f.commit).toHaveBeenCalledOnce();
      expect(f.events.slice(-2)).toEqual(['destroy', 'release']);
    },
  );

  it('preserves the original execution error when lock cleanup also fails', async () => {
    const f = fixture();
    f.work.mockRejectedValueOnce(new Error('original'));
    f.runner.query
      .mockResolvedValueOnce([{ acquired: 1 }])
      .mockRejectedValueOnce(new Error('unlock'));
    await expect(
      f.service.execute(scope, 'key', fingerprint, f.work),
    ).rejects.toThrow('original');
    expect(f.connection.destroy).toHaveBeenCalledOnce();
  });

  it('discards a transaction left active by failed rollback', async () => {
    const f = fixture();
    f.work.mockRejectedValueOnce(new Error('work'));
    f.rollback.mockRejectedValueOnce(new Error('rollback'));
    await expect(
      f.service.execute(scope, 'key', fingerprint, f.work),
    ).rejects.toThrow();
    expect(f.connection.destroy).toHaveBeenCalledOnce();
    expect(f.events).not.toContain('unlock');
  });
});
