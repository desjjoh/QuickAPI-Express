import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PoolConnection } from 'mysql2';

const native = vi.hoisted(() => ({ getConnection: vi.fn(), end: vi.fn() }));
vi.mock('mysql2', () => ({
  default: {
    createPool: () => ({
      getConnection: native.getConnection,
      end: native.end,
    }),
  },
}));

import { createBoundedMysqlPool } from '@/common/handlers/database-pool.handler';

const policy = {
  DB_POOL_CONNECTION_LIMIT: 1,
  DB_POOL_QUEUE_LIMIT: 1,
  DB_POOL_ACQUIRE_TIMEOUT_MS: 100,
  DB_CONNECT_TIMEOUT_MS: 1000,
};
function connection() {
  return Object.assign(new EventEmitter(), {
    release: vi.fn(),
    destroy: vi.fn(),
    query: vi.fn(),
  }) as unknown as PoolConnection;
}

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe('bounded pool ownership', () => {
  it('bounds queue capacity, removes expired waiters, and never runs work for expired acquisitions', async () => {
    vi.useFakeTimers();
    const acquired = connection();
    native.getConnection.mockImplementation((callback) =>
      callback(null, acquired),
    );
    const pool = createBoundedMysqlPool({}, policy);
    const first = vi.fn();
    const expired = vi.fn();
    const overflow = vi.fn();

    pool.getConnection(first);
    pool.getConnection(expired);
    pool.getConnection(overflow);
    expect(overflow.mock.calls[0][0]).toHaveProperty(
      'code',
      'DB_POOL_CAPACITY',
    );
    await vi.advanceTimersByTimeAsync(101);
    expect(expired.mock.calls[0][0]).toHaveProperty(
      'code',
      'DB_POOL_ACQUIRE_TIMEOUT',
    );
    expect(native.getConnection).toHaveBeenCalledTimes(1);
    first.mock.calls[0][1].release();
    const recovered = vi.fn();

    pool.getConnection(recovered);
    expect(recovered.mock.calls[0][0]).toBeNull();
    recovered.mock.calls[0][1].release();
    expect(acquired.query).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('releases a late lease without returning it to a timed-out caller', async () => {
    vi.useFakeTimers();
    let finish!: (error: null, lease: PoolConnection) => void;
    native.getConnection.mockImplementation((callback) => {
      finish = callback;
    });
    const pool = createBoundedMysqlPool({}, policy);
    const caller = vi.fn();

    pool.getConnection(caller);
    await vi.advanceTimersByTimeAsync(101);
    const late = connection();

    finish(null, late);
    expect(caller).toHaveBeenCalledOnce();
    expect(caller.mock.calls[0][0]).toHaveProperty(
      'code',
      'DB_POOL_ACQUIRE_TIMEOUT',
    );
    expect(late.release).toHaveBeenCalledOnce();
    expect(late.query).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops acquisition timers on lease handoff and releases each lease only once', async () => {
    vi.useFakeTimers();
    const raw = connection();
    native.getConnection.mockImplementation((callback) => callback(null, raw));
    const pool = createBoundedMysqlPool({}, policy);
    const caller = vi.fn();

    pool.getConnection(caller);
    const lease = caller.mock.calls[0][1] as PoolConnection;

    await vi.advanceTimersByTimeAsync(2000);
    expect(raw.destroy).not.toHaveBeenCalled();
    lease.release();
    lease.release();
    lease.destroy();
    expect(raw.release).toHaveBeenCalledOnce();
    expect(raw.destroy).not.toHaveBeenCalled();
    expect(raw.listenerCount('error')).toBe(0);
    expect(raw.listenerCount('end')).toBe(0);
  });

  it('rejects queued callers on pool close and rejects new admissions', () => {
    native.getConnection.mockImplementation((callback) =>
      callback(null, connection()),
    );
    native.end.mockImplementation((callback) => callback());
    const pool = createBoundedMysqlPool({}, policy);
    const first = vi.fn();
    const waiting = vi.fn();

    pool.getConnection(first);
    pool.getConnection(waiting);
    pool.end();
    expect(waiting.mock.calls[0][0]).toHaveProperty('code', 'DB_POOL_CLOSED');
    const next = vi.fn();

    pool.getConnection(next);
    expect(next.mock.calls[0][0]).toHaveProperty('code', 'DB_POOL_CLOSED');
    first.mock.calls[0][1].release();
  });
});
