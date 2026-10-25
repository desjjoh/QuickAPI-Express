import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from 'typeorm';
import { runInTransaction } from '@/common/helpers/transaction.helper';
import {
  RequestContext,
  RequestAbandonedError,
  runWithRequestContext,
  currentRequestContext,
} from '@/common/helpers/request-context.helper';
import { deferred } from '../helpers/http';

function fixture() {
  const commit = vi.fn();
  const rollback = vi.fn();
  const release = vi.fn();
  const connection = {};
  const transactional = {
    connection,
    queryRunner: { isTransactionActive: true },
  } as EntityManager;
  const manager = {
    connection,
    transaction: vi.fn(
      async (work: (manager: EntityManager) => Promise<unknown>) => {
        try {
          const value = await work(transactional);
          commit();
          return value;
        } catch (error) {
          rollback();
          throw error;
        } finally {
          release();
        }
      },
    ),
  } as unknown as EntityManager;
  return { manager, transactional, commit, rollback, release };
}

describe('request-aware application transactions', () => {
  it('commits non-HTTP work and reuses the manager for nested application transactions', async () => {
    const { manager, transactional, commit } = fixture();
    await expect(
      runInTransaction(manager, async (received) => {
        expect(received).toBe(transactional);
        return runInTransaction(received, async (nested) => {
          expect(nested).toBe(transactional);
          return 7;
        });
      }),
    ).resolves.toBe(7);
    expect(manager.transaction).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('rejects abandoned work before acquiring a transaction', async () => {
    const { manager } = fixture();
    const context = new RequestContext();
    context.abandon();
    await expect(
      runWithRequestContext(context, () =>
        runInTransaction(manager, async () => 1),
      ),
    ).rejects.toBeInstanceOf(RequestAbandonedError);
    expect(manager.transaction).not.toHaveBeenCalled();
  });

  it('checks the clock before work starts after delayed acquisition', async () => {
    const { manager } = fixture();
    const acquired = deferred();
    const context = new RequestContext();
    const work = vi.fn();
    vi.mocked(manager.transaction).mockImplementation(
      async (callback: unknown) => {
        await acquired.promise;
        return (callback as (manager: EntityManager) => Promise<unknown>)(
          manager,
        );
      },
    );
    const pending = runWithRequestContext(context, () =>
      runInTransaction(manager, work),
    );
    context.setDeadline(0);
    acquired.resolve();
    await expect(pending).rejects.toBeInstanceOf(RequestAbandonedError);
    expect(work).not.toHaveBeenCalled();
  });

  it('keeps concurrent request contexts separate and drains work before rollback/release', async () => {
    const first = fixture();
    const second = fixture();
    const context = new RequestContext();
    const finish = deferred<number>();
    const began = deferred();
    const pending = runWithRequestContext(context, () =>
      runInTransaction(first.manager, async () => {
        began.resolve();
        await finish.promise;
        expect(currentRequestContext()).toBe(context);
        return 1;
      }),
    );
    const rejected = expect(pending).rejects.toBeInstanceOf(
      RequestAbandonedError,
    );
    await began.promise;
    context.abandon();
    expect(first.rollback).not.toHaveBeenCalled();
    expect(first.release).not.toHaveBeenCalled();
    await runWithRequestContext(new RequestContext(), () =>
      runInTransaction(second.manager, async () => 2),
    );
    finish.resolve(1);
    await rejected;
    expect(first.commit).not.toHaveBeenCalled();
    expect(first.rollback).toHaveBeenCalledTimes(1);
    expect(first.release).toHaveBeenCalledTimes(1);
    expect(second.commit).toHaveBeenCalledTimes(1);
  });

  it('checks wall-clock expiry before commit even before a timeout callback runs', async () => {
    const { manager, commit, rollback } = fixture();
    const context = new RequestContext();
    await expect(
      runWithRequestContext(context, () =>
        runInTransaction(manager, async () => {
          context.setDeadline(0);
          return 1;
        }),
      ),
    ).rejects.toBeInstanceOf(RequestAbandonedError);
    expect(commit).not.toHaveBeenCalled();
    expect(rollback).toHaveBeenCalledTimes(1);
  });

  it('rolls back business failures and releases resources', async () => {
    const { manager, commit, rollback, release } = fixture();
    const failure = new Error('Business failure');
    await expect(
      runInTransaction(manager, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(commit).not.toHaveBeenCalled();
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('rejects unmanaged or cross-source nested transactions', async () => {
    const first = fixture();
    const second = fixture();
    await expect(
      runInTransaction(first.transactional, async () => 1),
    ).rejects.toThrow('Start application transactions');
    await expect(
      runInTransaction(first.manager, async () =>
        runInTransaction(second.manager, async () => 1),
      ),
    ).rejects.toThrow('same data source');
    expect(first.rollback).toHaveBeenCalledTimes(1);
  });
});
