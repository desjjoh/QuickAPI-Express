import { describe, expect, it } from 'vitest';
import { RollingWindowLimiter } from '@/common/handlers/rate-limit.handler';
import { createRateLimitMiddleware } from '@/common/middleware/rate-limit.middleware';

describe('bounded rolling-window storage', () => {
  it('expires timestamps at the exact boundary without fixed-window resets', () => {
    let now = 0;
    const limiter = new RollingWindowLimiter(
      { windowMs: 1_000, max: 2 },
      () => now,
    );
    expect(limiter.admit('a').allowed).toBe(true);
    now = 500;
    expect(limiter.admit('a').allowed).toBe(true);
    now = 999;
    expect(limiter.admit('a')).toEqual({
      allowed: false,
      status: 429,
      retryAfterSeconds: 1,
    });
    now = 1_000;
    expect(limiter.admit('a').allowed).toBe(true);
    now = 1_499;
    expect(limiter.admit('a').allowed).toBe(false);
    now = 1_500;
    expect(limiter.admit('a').allowed).toBe(true);
    expect(limiter.usage.storedRequests).toBe(2);
  });

  it('does not add history or extend a penalty during sustained rejected traffic', () => {
    let now = 0;
    const limiter = new RollingWindowLimiter(
      { windowMs: 1_000, max: 2, maxClients: 2 },
      () => now,
    );
    limiter.admit('a');
    limiter.admit('a');
    now = 900;
    for (let index = 0; index < 20_000; index++)
      expect(limiter.admit('a').allowed).toBe(false);
    expect(limiter.usage).toEqual({
      clients: 1,
      storedRequests: 2,
      timestampSlots: 2,
    });
    now = 1_000;
    expect(limiter.admit('a').allowed).toBe(true);
    expect(limiter.usage.storedRequests).toBe(1);
  });

  it('bounds distinct identities, retains active quotas, and reclaims capacity on expiry', () => {
    let now = 0;
    const limiter = new RollingWindowLimiter(
      { windowMs: 2_500, max: 1, maxClients: 3 },
      () => now,
    );
    for (const key of ['a', 'b', 'c'])
      expect(limiter.admit(key).allowed).toBe(true);
    now = 1_001;
    for (let index = 0; index < 10_000; index++)
      expect(limiter.admit(`new-${index}`)).toEqual({
        allowed: false,
        status: 503,
        retryAfterSeconds: 2,
      });
    expect(limiter.usage).toEqual({
      clients: 3,
      storedRequests: 3,
      timestampSlots: 3,
    });
    expect(limiter.admit('a')).toMatchObject({ status: 429 });
    now = 2_500;
    expect(limiter.admit('new').allowed).toBe(true);
    expect(limiter.usage).toEqual({
      clients: 1,
      storedRequests: 1,
      timestampSlots: 1,
    });
  });

  it('orders expiry by last admission and allows tracked clients at capacity', () => {
    let now = 0;
    const limiter = new RollingWindowLimiter(
      { windowMs: 5_000, max: 2, maxClients: 2 },
      () => now,
    );
    limiter.admit('a');
    now = 1_000;
    limiter.admit('b');
    now = 2_000;
    expect(limiter.admit('a').allowed).toBe(true);
    expect(limiter.admit('c')).toEqual({
      allowed: false,
      status: 503,
      retryAfterSeconds: 4,
    });
    now = 5_999;
    expect(limiter.admit('b')).toMatchObject({ allowed: true });
    // b is still active, so its admitted request moves it after a's expiry.
    expect(limiter.admit('c')).toEqual({
      allowed: false,
      status: 503,
      retryAfterSeconds: 2,
    });
    now = 7_000;
    expect(limiter.admit('c').allowed).toBe(true);
    expect(limiter.admit('b').allowed).toBe(true);
    expect(limiter.admit('b')).toMatchObject({ allowed: false, status: 429 });
  });

  it('keeps counters independent between instances', () => {
    const options = { windowMs: 1_000, max: 1 };
    const first = new RollingWindowLimiter(options);
    const second = new RollingWindowLimiter(options);
    expect(first.admit('same').allowed).toBe(true);
    expect(first.admit('same').allowed).toBe(false);
    expect(second.admit('same').allowed).toBe(true);
  });

  it.each([
    { windowMs: 0, max: 1 },
    { windowMs: 86_400_001, max: 1 },
    { windowMs: 1_000, max: 0 },
    { windowMs: 1_000, max: 1.5 },
    { windowMs: 1_000, max: 10_001 },
    { windowMs: 1_000, max: 1, maxClients: 0 },
    { windowMs: 1_000, max: 1, maxClients: 100_001 },
    { windowMs: 1_000, max: 201, maxClients: 10_000 },
  ])('rejects invalid or excessive store configuration: %j', (options) => {
    expect(() => createRateLimitMiddleware(options)).toThrow();
  });
});
