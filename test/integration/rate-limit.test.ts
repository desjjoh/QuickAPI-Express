import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '@/config/http-server.config';
import { env } from '@/config/env.config';

afterEach(() => vi.restoreAllMocks());

const trustedProxy = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];

describe('configured HTTP rate limiting', () => {
  it('enforces one quota under a concurrent burst while leaving another trusted client independent', async () => {
    const app = createApp({
      ...env,
      TRUST_PROXY: trustedProxy,
      RATE_LIMIT_MAX: 5,
    });
    const responses = await Promise.all(
      Array.from({ length: 20 }, () =>
        request(app).get('/').set('X-Forwarded-For', '198.51.100.1'),
      ),
    );
    expect(
      responses.filter((response) => response.status === 200),
    ).toHaveLength(5);
    const rejected = responses.filter((response) => response.status === 429);
    expect(rejected).toHaveLength(15);
    expect(
      rejected.every((response) => Number(response.headers['retry-after']) > 0),
    ).toBe(true);
    expect(
      (await request(app).get('/').set('X-Forwarded-For', '198.51.100.2'))
        .status,
    ).toBe(200);
  });
  it('reports the remaining rolling-window delay, not the whole window', async () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const app = createApp({
      ...env,
      RATE_LIMIT_WINDOW_MS: 2_500,
      RATE_LIMIT_MAX: 2,
    });
    expect((await request(app).get('/')).status).toBe(200);
    now = 1_000;
    expect((await request(app).get('/')).status).toBe(200);
    now = 1_250;
    const response = await request(app).get('/');
    expect(response.status).toBe(429);
    expect(response.headers['retry-after']).toBe('2');
    expect(response.body).toMatchObject({
      status: 429,
      timestamp: expect.any(Number),
    });
    now = 2_500;
    expect((await request(app).get('/')).status).toBe(200);
  });

  it('rejects new trusted forwarded identities at capacity without resetting existing quotas', async () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const app = createApp({
      ...env,
      TRUST_PROXY: trustedProxy,
      RATE_LIMIT_WINDOW_MS: 2_500,
      RATE_LIMIT_MAX: 2,
      RATE_LIMIT_MAX_CLIENTS: 1,
    });
    const get = (ip: string) =>
      request(app).get('/').set('X-Forwarded-For', ip);
    expect((await get('198.51.100.1')).status).toBe(200);
    now = 1_001;
    const full = await get('198.51.100.2');
    expect(full.status).toBe(503);
    expect(full.headers['retry-after']).toBe('2');
    expect(full.body).toMatchObject({ status: 503 });
    expect((await get('198.51.100.1')).status).toBe(200);
    expect((await get('198.51.100.1')).status).toBe(429);
    now = 3_501;
    expect((await get('198.51.100.2')).status).toBe(200);
  });

  it('does not create new client identities from untrusted forwarded headers', async () => {
    const app = createApp({
      ...env,
      TRUST_PROXY: [],
      RATE_LIMIT_MAX: 2,
      RATE_LIMIT_MAX_CLIENTS: 1,
    });
    for (const ip of ['198.51.100.1', '198.51.100.2'])
      expect(
        (await request(app).get('/').set('X-Forwarded-For', ip)).status,
      ).toBe(200);
    expect(
      (await request(app).get('/').set('X-Forwarded-For', '198.51.100.3'))
        .status,
    ).toBe(429);
  });
});
