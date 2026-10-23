import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import { DatabaseReadiness } from '@/common/handlers/database-readiness.handler';
import { deferred } from '../helpers/http';

afterEach(() => vi.useRealTimers());

function fixture() {
  const connection = { destroy: vi.fn() };
  const runner = {
    connect: vi.fn().mockResolvedValue(connection),
    query: vi.fn().mockResolvedValue([{ healthy: 1 }]),
    release: vi.fn().mockResolvedValue(undefined),
  };
  const source = {
    isInitialized: true,
    createQueryRunner: vi.fn(() => runner),
  };
  const readiness = new DatabaseReadiness(source as unknown as DataSource, {
    DB_READINESS_TIMEOUT_MS: 100,
    DB_READINESS_CACHE_MS: 20,
  });
  return { connection, runner, source, readiness };
}

describe('database probe resource ownership', () => {
  it('releases a connection acquired after shutdown without running SQL or restoring readiness', async () => {
    vi.useFakeTimers();
    const { connection, runner, readiness } = fixture();
    const acquired = deferred<typeof connection>();
    runner.connect.mockReturnValueOnce(acquired.promise);
    const result = readiness.check();
    readiness.stop();
    expect(await result).toBe(false);
    acquired.resolve(connection);
    await vi.advanceTimersByTimeAsync(0);
    expect(runner.query).not.toHaveBeenCalled();
    expect(runner.release).toHaveBeenCalledTimes(1);
    expect(await readiness.check()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('shares a timed-out acquisition until its late connection is released without SQL', async () => {
    vi.useFakeTimers();
    const { runner, source, readiness } = fixture();
    const acquired = deferred();
    runner.connect.mockReturnValueOnce(acquired.promise);
    const checks = Array.from({ length: 40 }, () => readiness.check());
    await vi.advanceTimersByTimeAsync(101);
    expect(await Promise.all(checks)).toEqual(Array(40).fill(false));
    await vi.advanceTimersByTimeAsync(100);
    expect(await readiness.check()).toBe(false);
    expect(source.createQueryRunner).toHaveBeenCalledTimes(1);
    acquired.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(runner.query).not.toHaveBeenCalled();
    expect(runner.release).toHaveBeenCalledTimes(1);
    expect(await readiness.check()).toBe(true);
    expect(source.createQueryRunner).toHaveBeenCalledTimes(2);
  });

  it('destroys a stalled query connection, releases its runner, and can recover', async () => {
    vi.useFakeTimers();
    const { connection, runner, readiness } = fixture();
    runner.query.mockReturnValueOnce(new Promise(() => undefined));
    const result = readiness.check();
    await vi.advanceTimersByTimeAsync(101);
    expect(await result).toBe(false);
    expect(connection.destroy).toHaveBeenCalled();
    expect(runner.release).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(21);
    expect(await readiness.check()).toBe(true);
  });

  it('releases successful probes, caches results briefly, and stops active work before pool teardown', async () => {
    vi.useFakeTimers();
    const { connection, source, runner, readiness } = fixture();
    expect(await readiness.check()).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(runner.release).toHaveBeenCalledTimes(1);
    expect(await readiness.check()).toBe(true);
    expect(source.createQueryRunner).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(21);
    runner.query.mockReturnValueOnce(new Promise(() => undefined));
    const result = readiness.check();
    await vi.advanceTimersByTimeAsync(0);
    readiness.stop();
    expect(await result).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(connection.destroy).toHaveBeenCalled();
    expect(runner.release).toHaveBeenCalledTimes(2);
    expect(await readiness.check()).toBe(false);
    expect(source.createQueryRunner).toHaveBeenCalledTimes(2);
  });
});
