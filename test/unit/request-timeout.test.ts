import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestTimeout } from '@/common/middleware/request-timeout.middleware';
import { RequestTimeoutError } from '@/common/exceptions/http.exception';

afterEach(() => vi.useRealTimers());

function fixture() {
  const req = new EventEmitter();
  const res = Object.assign(new EventEmitter(), {
    destroyed: false,
    headersSent: true,
    writableEnded: true,
    writableFinished: false,
    destroy: vi.fn(),
  });
  const next = vi.fn();
  requestTimeout(50)(req as never, res as never, next);
  return { req, res, next };
}

describe('response deadline completion states', () => {
  it('terminates an ended response when its final write has not finished', async () => {
    vi.useFakeTimers();
    const { req, res, next } = fixture();
    await vi.advanceTimersByTimeAsync(50);
    expect(res.destroy).toHaveBeenCalledWith(expect.any(RequestTimeoutError));
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.listenerCount('aborted')).toBe(0);
    expect(res.listenerCount('finish')).toBe(0);
    expect(res.listenerCount('close')).toBe(0);
  });

  it.each(['finish', 'close'])(
    'cleans the timer and listeners on %s without another failure',
    async (event) => {
      vi.useFakeTimers();
      const { req, res, next } = fixture();
      res.writableFinished = event === 'finish';
      res.emit(event);
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(100);
      expect(res.destroy).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
      expect(req.listenerCount('aborted')).toBe(0);
      expect(res.listenerCount('finish')).toBe(0);
      expect(res.listenerCount('close')).toBe(0);
    },
  );
});
