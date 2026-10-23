import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '@/config/http-server.config';
import { env, type Env } from '@/config/env.config';

// Exercise the production middleware stack without requiring a database fixture.
vi.mock('@/api/api.routes', async () => {
  const { Router } = await import('express');
  const { RequestContext } =
    await import('@/common/store/request-context.store');
  const router = Router();
  router.get('/identity', (req, res) => {
    res.json({
      ip: req.ip,
      peer: req.socket.remoteAddress,
      contextIp: RequestContext.get()?.ip,
      protocol: req.protocol,
      hostname: req.hostname,
      headers: req.headers,
    });
  });
  return { default: router };
});

const trustedLocalProxy = ['127.0.0.1/8', '::1/128'];

describe('configured HTTP policy in the application stack', () => {
  it('uses the direct peer and discards spoofed forwarding metadata by default', async () => {
    const app = createApp({
      ...env,
      TRUST_PROXY: [],
      CORS_ALLOWED_HEADERS: [...env.CORS_ALLOWED_HEADERS, 'x-forwarded-for'],
    });
    const direct = await request(app).get('/identity');
    const spoofed = await request(app)
      .get('/identity')
      .set('X-Forwarded-For', '198.51.100.23')
      .set('X-Forwarded-Host', 'evil.example')
      .set('X-Forwarded-Proto', 'https')
      .set('Forwarded', 'for=198.51.100.23;proto=https')
      .set('Via', 'proxy.example');

    expect(direct.status).toBe(200);
    expect(direct.body.ip).toBe(direct.body.peer);
    expect(spoofed.status).toBe(200);
    expect(spoofed.body.ip).toBe(spoofed.body.peer);
    expect(spoofed.body.contextIp).toBe(spoofed.body.ip);
    expect(spoofed.body.protocol).toBe('http');
    expect(spoofed.body.hostname).not.toBe('evil.example');
    for (const header of [
      'x-forwarded-for',
      'x-forwarded-host',
      'x-forwarded-proto',
      'forwarded',
      'via',
    ]) {
      expect(spoofed.body.headers).not.toHaveProperty(header);
    }
  });

  it('uses forwarded identity consistently for a trusted transport peer', async () => {
    const app = createApp({ ...env, TRUST_PROXY: trustedLocalProxy });
    const response = await request(app)
      .get('/identity')
      .set('X-Forwarded-For', '198.51.100.23')
      .set('X-Forwarded-Host', 'api.example')
      .set('X-Forwarded-Proto', 'https');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ip: '198.51.100.23',
      contextIp: '198.51.100.23',
      hostname: 'api.example',
      protocol: 'https',
    });
    expect(response.body.headers['x-forwarded-for']).toBe('198.51.100.23');
  });

  it('ignores forwarding from a peer outside the configured trusted network', async () => {
    const response = await request(
      createApp({ ...env, TRUST_PROXY: ['10.20.0.0/16'] }),
    )
      .get('/identity')
      .set('X-Forwarded-For', '198.51.100.23');

    expect(response.status).toBe(200);
    expect(response.body.ip).toBe(response.body.peer);
    expect(response.body.contextIp).toBe(response.body.peer);
    expect(response.body.headers).not.toHaveProperty('x-forwarded-for');
  });

  it('stops at the nearest untrusted hop instead of trusting a spoofed leftmost address', async () => {
    const response = await request(
      createApp({
        ...env,
        TRUST_PROXY: [...trustedLocalProxy, '10.20.0.0/16'],
      }),
    )
      .get('/identity')
      .set('X-Forwarded-For', '198.51.100.99, 203.0.113.23, 10.20.0.7');

    expect(response.status).toBe(200);
    expect(response.body.ip).toBe('203.0.113.23');
    expect(response.body.contextIp).toBe('203.0.113.23');
  });

  it('does not let changing untrusted forwarding addresses evade the rate limiter', async () => {
    const app = createApp({ ...env, TRUST_PROXY: [] });
    for (let index = 0; index < 200; index++) {
      const response = await request(app)
        .get('/identity')
        .set('X-Forwarded-For', `198.51.100.${index}`);
      expect(response.status).toBe(200);
    }

    const blocked = await request(app)
      .get('/identity')
      .set('X-Forwarded-For', '203.0.113.9');
    expect(blocked.status).toBe(429);
  });

  it('rate limits trusted forwarded clients independently', async () => {
    const app = createApp({ ...env, TRUST_PROXY: trustedLocalProxy });
    for (let index = 0; index < 200; index++) {
      expect(
        (
          await request(app)
            .get('/identity')
            .set('X-Forwarded-For', '198.51.100.1')
        ).status,
      ).toBe(200);
    }

    expect(
      (
        await request(app)
          .get('/identity')
          .set('X-Forwarded-For', '198.51.100.1')
      ).status,
    ).toBe(429);
    expect(
      (
        await request(app)
          .get('/identity')
          .set('X-Forwarded-For', '198.51.100.2')
      ).status,
    ).toBe(200);
  });

  const corsPolicy: Env = {
    ...env,
    CORS_ORIGINS: ['https://web.example', 'https://admin.example'],
    CORS_METHODS: ['GET', 'POST'],
    CORS_ALLOWED_HEADERS: ['Content-Type', 'X-Trace-Client'],
    CORS_EXPOSED_HEADERS: ['X-Request-Id'],
    CORS_CREDENTIALS: false,
    CORS_MAX_AGE_SECONDS: 60,
  };

  it('preserves and validates browser preflight through header sanitization', async () => {
    const app = createApp(corsPolicy);
    const preflight = await request(app)
      .options('/identity')
      .set('Origin', 'https://web.example')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type, X-TRACE-CLIENT');

    expect(preflight.status).toBe(204);
    expect(preflight.headers).toMatchObject({
      'access-control-allow-origin': 'https://web.example',
      'access-control-allow-methods': 'GET, POST',
      'access-control-allow-headers': 'Content-Type, X-Trace-Client',
      'access-control-expose-headers': 'X-Request-Id',
      'access-control-max-age': '60',
    });
    expect(preflight.headers).not.toHaveProperty(
      'access-control-allow-credentials',
    );
    expect(preflight.headers.vary).toContain('Origin');
    expect(preflight.headers.vary).toContain('Access-Control-Request-Method');
    expect(preflight.headers.vary).toContain('Access-Control-Request-Headers');

    const actual = await request(app)
      .get('/identity')
      .set('Origin', 'https://web.example')
      .set('X-Trace-Client', 'kept');
    expect(actual.status).toBe(200);
    expect(actual.body.headers['x-trace-client']).toBe('kept');
  });

  it.each([
    ['https://evil.example', 'POST', 'content-type'],
    ['https://web.example', 'DELETE', 'content-type'],
    ['https://web.example', 'POST', 'x-not-allowed'],
  ])(
    'rejects unsupported preflight %s %s %s',
    async (origin, method, headers) => {
      const response = await request(createApp(corsPolicy))
        .options('/identity')
        .set('Origin', origin)
        .set('Access-Control-Request-Method', method)
        .set('Access-Control-Request-Headers', headers);

      expect(response.status).toBe(403);
      expect(response.headers.vary).toContain('Origin');
    },
  );

  it('varies allowed, rejected, and no-origin responses', async () => {
    const app = createApp(corsPolicy);
    for (const origin of ['https://web.example', 'https://admin.example']) {
      const response = await request(app)
        .get('/identity')
        .set('Origin', origin);
      expect(response.status).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBe(origin);
      expect(response.headers.vary).toContain('Origin');
    }

    const noOrigin = await request(app).get('/identity');
    expect(noOrigin.status).toBe(200);
    expect(noOrigin.headers).not.toHaveProperty('access-control-allow-origin');
    expect(noOrigin.headers.vary).toContain('Origin');

    const denied = await request(app)
      .get('/identity')
      .set('Origin', 'https://web.example.evil.test');
    expect(denied.status).toBe(403);
    expect(denied.headers).not.toHaveProperty('access-control-allow-origin');
    expect(denied.headers.vary).toContain('Origin');
  });
});
