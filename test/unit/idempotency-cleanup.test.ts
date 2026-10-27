import { afterEach, describe, expect, it, vi } from 'vitest';
import { IdempotencyCleanupService } from '@/common/services/idempotency-cleanup.service';
import { IDEMPOTENCY_CLEANUP_INTERVAL_MS } from '@/common/library/models/idempotency-policy.model';
import { logger } from '@/config/logger.config';
import { deferred } from '../helpers/http';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe('lifecycle-owned replay cleanup', () => {
  it('starts one hourly unreferenced timer, stops early on a short batch and stops scheduling on quiesce', async () => {
    vi.useFakeTimers();
    const repository = {
      purgeExpiredBatch: vi
        .fn()
        .mockResolvedValueOnce(100)
        .mockResolvedValue(7),
    };
    const service = new IdempotencyCleanupService(repository);
    const interval = vi.spyOn(globalThis, 'setInterval');
    service.start();
    service.start();
    expect(interval).toHaveBeenCalledTimes(1);
    expect(interval.mock.results[0].value.hasRef()).toBe(false);
    expect(repository.purgeExpiredBatch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(IDEMPOTENCY_CLEANUP_INTERVAL_MS);
    expect(repository.purgeExpiredBatch.mock.calls).toEqual([[100], [100]]);
    service.quiesce();
    await vi.advanceTimersByTimeAsync(IDEMPOTENCY_CLEANUP_INTERVAL_MS * 2);
    expect(repository.purgeExpiredBatch).toHaveBeenCalledTimes(2);
    await service.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('caps a sweep at ten batches and allows a later sweep', async () => {
    const repository = { purgeExpiredBatch: vi.fn().mockResolvedValue(100) };
    const service = new IdempotencyCleanupService(repository);
    service.start();
    try {
      await service.sweep();
      expect(repository.purgeExpiredBatch).toHaveBeenCalledTimes(10);
      await service.sweep();
      expect(repository.purgeExpiredBatch).toHaveBeenCalledTimes(20);
    } finally {
      await service.stop();
    }
  });

  it('shares a stalled sweep and waits for its accepted batch before shutdown, without starting more batches', async () => {
    vi.useFakeTimers();
    const finish = deferred<number>();
    const repository = { purgeExpiredBatch: vi.fn(() => finish.promise) };
    const service = new IdempotencyCleanupService(repository);
    service.start();
    const first = service.sweep();
    expect(service.sweep()).toBe(first);
    await vi.advanceTimersByTimeAsync(IDEMPOTENCY_CLEANUP_INTERVAL_MS * 2);
    expect(repository.purgeExpiredBatch).toHaveBeenCalledTimes(1);
    let stopped = false;
    const stop = service.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    finish.resolve(100);
    await stop;
    expect(repository.purgeExpiredBatch).toHaveBeenCalledTimes(1);
    await service.sweep();
    expect(repository.purgeExpiredBatch).toHaveBeenCalledTimes(1);
  });

  it('logs a timer failure once, releases its in-flight state and retries next hour', async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const repository = {
      purgeExpiredBatch: vi
        .fn()
        .mockRejectedValueOnce(new Error('database unavailable'))
        .mockResolvedValue(0),
    };
    const service = new IdempotencyCleanupService(repository);
    service.start();
    await vi.advanceTimersByTimeAsync(IDEMPOTENCY_CLEANUP_INTERVAL_MS);
    expect(log).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(IDEMPOTENCY_CLEANUP_INTERVAL_MS);
    expect(repository.purgeExpiredBatch).toHaveBeenCalledTimes(2);
    await service.stop();
  });

  it('propagates an active sweep failure to shutdown and validates cleanup policy', async () => {
    const finish = deferred<number>();
    const service = new IdempotencyCleanupService({
      purgeExpiredBatch: () => finish.promise,
    });
    service.start();
    const sweep = service.sweep();
    const stop = service.stop();
    finish.reject(new Error('failure'));
    await expect(sweep).rejects.toThrow('failure');
    await expect(stop).rejects.toThrow('failure');
    expect(
      () =>
        new IdempotencyCleanupService(undefined, {
          cleanupBatchSize: 1000,
          cleanupMaxBatches: 100,
        }),
    ).toThrow();
  });
});
