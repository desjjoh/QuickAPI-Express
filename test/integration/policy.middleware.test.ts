import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { errorHandler } from '@/common/middleware/error-handler.middleware';
import { enforceContentType } from '@/common/middleware/content-type.middleware';
import { methodWhitelist } from '@/common/middleware/method-whitelist.middleware';
import { enforceHeaderLimits } from '@/common/middleware/header-size-limit.middleware';
import { sanitizeHeaders } from '@/common/middleware/header-sanitization.middleware';
import { bodyLimitMiddleware } from '@/common/middleware/request-body-limit.middleware';
import { createCorsMiddleware } from '@/common/middleware/cors.middleware';
import { requestContextMiddleware } from '@/common/middleware/request-context.middleware';
import { RequestContext } from '@/common/store/request-context.store';
import { createRateLimitMiddleware } from '@/common/middleware/rate-limit.middleware';

function mount(middleware: express.RequestHandler) {
  const app = express();
  app.use(middleware);
  app.all('/test', (req, res) =>
    res.json({ headers: req.headers, requestId: RequestContext.getId(), body: req.body }),
  );
  app.use(errorHandler);
  return app;
}

describe('security and policy middleware', () => {
  it('requires an allowed content type for body methods but accepts parameterized JSON', async () => {
    expect((await request(mount(enforceContentType())).post('/test')).status).toBe(415);
    expect(
      (
        await request(mount(enforceContentType()))
          .post('/test')
          .set('Content-Type', 'application/json; charset=utf-8')
      ).status,
    ).toBe(200);
    expect(
      (
        await request(mount(enforceContentType()))
          .get('/test')
          .set('Content-Type', 'application/json')
      ).status,
    ).toBe(415);
  });
  it('enforces the configured method allowlist', async () => {
    const app = mount(methodWhitelist({ allowedMethods: new Set(['GET']) }));
    expect((await request(app).get('/test')).status).toBe(200);
    expect((await request(app).post('/test')).status).toBe(405);
  });
  it('enforces count, per-header, total, and transfer encoding boundaries', () => {
    const middleware = enforceHeaderLimits({
      maxHeaderCount: 1,
      maxSingleHeaderBytes: 4,
      maxTotalHeaderBytes: 4,
      allowChunked: false,
    });
    const next = vi.fn();
    const response = {} as express.Response;
    middleware({ headers: { a: '123' } } as unknown as express.Request, response, next);
    expect(next).toHaveBeenLastCalledWith();
    for (const headers of [
      { a: '1', b: '2' },
      { a: '1234' },
      { aa: '1', b: '1' },
      { 'transfer-encoding': 'chunked' },
    ]) {
      next.mockClear();
      middleware({ headers } as unknown as express.Request, response, next);
      expect(next.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    }
  });
  it('removes unrecognized headers and rejects forwarding headers', async () => {
    const ok = await request(mount(sanitizeHeaders()))
      .get('/test')
      .set('X-Untrusted', 'gone')
      .set('X-Request-Id', 'kept');
    expect(ok.body.headers).not.toHaveProperty('x-untrusted');
    expect(ok.body.headers['x-request-id']).toBe('kept');
    expect(
      (await request(mount(sanitizeHeaders())).get('/test').set('X-Forwarded-Host', 'evil')).status,
    ).toBe(400);
  });
  it('applies route-specific body limits at the byte boundary', async () => {
    const app = mount(bodyLimitMiddleware({ defaultLimit: 7, routeOverrides: [['/test', 8]] }));
    expect((await request(app).post('/test').type('json').send('{}')).status).toBe(200);
    const oversized = await request(app).post('/test').type('json').send('{"long":1}');
    expect(oversized.status).toBe(413);
    expect(oversized.headers['x-body-remaining-bytes']).toBe('0');
  });
  it('sets CORS policy for allowed preflight and rejects unknown origins', async () => {
    const cors = createCorsMiddleware({
      origin: ['https://good.test'],
      methods: ['GET'],
      allowedHeaders: ['content-type'],
      exposedHeaders: [],
      credentials: true,
      maxAge: 60,
    });
    const ok = await request(mount(cors)).options('/test').set('Origin', 'https://good.test');
    expect(ok.status).toBe(204);
    expect(ok.headers['access-control-allow-origin']).toBe('https://good.test');
    expect(
      (await request(mount(cors)).get('/test').set('Origin', 'https://evil.test')).status,
    ).toBe(403);
  });
  it('creates a request ID and rate limits independently by key', async () => {
    const context = await request(mount(requestContextMiddleware)).get('/test');
    expect(context.body.requestId).toMatch(/^[A-Za-z0-9_-]+$/);
    const limiter = createRateLimitMiddleware({
      windowMs: 60_000,
      max: 1,
      keyGenerator: req => String(req.headers['x-api-key']),
    });
    const app = mount(limiter);
    expect((await request(app).get('/test').set('X-Api-Key', 'a')).status).toBe(200);
    const blocked = await request(app).get('/test').set('X-Api-Key', 'a');
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBe('60');
    expect((await request(app).get('/test').set('X-Api-Key', 'b')).status).toBe(200);
  });
});
