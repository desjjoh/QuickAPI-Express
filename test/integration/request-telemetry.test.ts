import express from 'express';
import request from 'supertest';
import { Agent, get, request as httpRequest, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '@/config/http-server.config';
import { env } from '@/config/env.config';
import { logger } from '@/config/logger.config';
import {
  httpRequestAbortedCounter,
  httpRequestCounter,
  httpRequestDuration,
  metricsRegistry,
} from '@/config/metrics.config';
import { metricsMiddleware } from '@/common/middleware/metrics.middleware';
import { httpLogger } from '@/common/middleware/http-logger.middleware';
import { requestContextMiddleware } from '@/common/middleware/request-context.middleware';
import { errorHandler } from '@/common/middleware/error-handler.middleware';
import { requestTimeout } from '@/common/middleware/request-timeout.middleware';
import { logRoute } from '@/common/helpers/request-log.helper';
import { deferred, portOf } from '../helpers/http';

vi.mock('@/database/repositories/item.repo', () => ({
  itemRepository: { get_by_id: vi.fn(async () => null) },
}));

const servers: Server[] = [];
const agents: Agent[] = [];

beforeEach(() => metricsRegistry.resetMetrics());
afterEach(async () => {
  for (const agent of agents.splice(0)) agent.destroy();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.closeAllConnections();
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
  vi.restoreAllMocks();
});

function fixture() {
  const logs: Record<string, unknown>[] = [];

  for (const level of ['debug', 'warn', 'error'] as const) {
    vi.spyOn(logger, level).mockImplementation(
      (fields: unknown, message?: string) => {
        logs.push({ ...(fields as object), level, message });
      },
    );
  }
  const app = express();

  app.use(metricsMiddleware, requestContextMiddleware, httpLogger);

  return { app, logs, access: () => logs.filter((entry) => entry.outcome) };
}

async function listen(app: express.Express) {
  const server = app.listen(0, '127.0.0.1');

  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  return server;
}

async function counts() {
  return {
    completed: (await httpRequestCounter.get()).values.reduce(
      (sum, value) => sum + value.value,
      0,
    ),
    aborted: (await httpRequestAbortedCounter.get()).values.reduce(
      (sum, value) => sum + value.value,
      0,
    ),
  };
}

describe('request outcomes and bounded metrics', () => {
  it('counts a completed 500 once without classifying it as a disconnect', async () => {
    const { app, access } = fixture();

    app.get('/failure', () => {
      throw new Error('private-provider-failure');
    });
    app.use(errorHandler);
    expect((await request(app).get('/failure')).status).toBe(500);
    expect(access()).toHaveLength(1);
    expect(access()[0]).toMatchObject({
      outcome: 'completed',
      status: 500,
      route: '/failure',
      level: 'error',
    });
    expect(await counts()).toEqual({ completed: 1, aborted: 0 });
    expect((await httpRequestCounter.get()).values[0].labels).toEqual({
      method: 'GET',
      route: '/failure',
      status: '500',
    });
  });

  it('preserves completed metric contracts and uses the same full-precision duration as the log', async () => {
    const { app, access } = fixture();

    app.get('/ok', (_req, res) => res.end());
    await request(app).get('/ok');
    const counter = await httpRequestCounter.get();
    const histogram = await httpRequestDuration.get();

    expect(counter.name).toBe('http_requests_total');
    expect(counter.values).toEqual([
      expect.objectContaining({
        labels: { method: 'GET', route: '/ok', status: '200' },
        value: 1,
      }),
    ]);
    expect(histogram.name).toBe('http_request_duration_ms');
    expect(
      histogram.values.find(
        (value) => value.metricName === 'http_request_duration_ms_sum',
      )?.value,
    ).toBe(access()[0].durationMs);
    expect(access()).toHaveLength(1);
    expect(access()[0]).toMatchObject({
      outcome: 'completed',
      status: 200,
      level: 'debug',
    });
    expect(await counts()).toEqual({ completed: 1, aborted: 0 });
  });

  it('records routed, unmatched, policy-rejected and failed responses without client-valued labels', async () => {
    const app = createApp({ ...env, RATE_LIMIT_MAX: 100 });

    await request(app).get(
      '/api/v1/items/A1b2C3d4E5f6G7h8?token=private-query',
    );
    await request(app).get('/missing/private-user');
    await request(app).trace('/another/private-user');
    const values = (await httpRequestCounter.get()).values;

    expect(values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          labels: { method: 'GET', route: '/api/v1/items/:id', status: '404' },
          value: 1,
        }),
        expect.objectContaining({
          labels: { method: 'GET', route: '<unmatched>', status: '404' },
          value: 1,
        }),
        expect.objectContaining({
          labels: { method: '<other>', route: '<unmatched>', status: '405' },
          value: 1,
        }),
      ]),
    );
    expect(JSON.stringify(values)).not.toMatch(
      /private-|A1b2C3d4E5f6G7h8|token=/,
    );
    const limited = createApp({ ...env, RATE_LIMIT_MAX: 1 });

    await request(limited).get('/health');
    expect((await request(limited).get('/health')).status).toBe(429);
    expect((await httpRequestCounter.get()).values).toContainEqual(
      expect.objectContaining({
        labels: { method: 'GET', route: '<unmatched>', status: '429' },
        value: 1,
      }),
    );
  });

  it('bounds many concrete paths and item IDs to two route series', async () => {
    const app = createApp({ ...env, RATE_LIMIT_MAX: 200 });

    for (let index = 0; index < 35; index++) {
      await request(app).get(
        `/api/v1/items/${String(index).padStart(16, '0')}?token=secret${index}`,
      );
      await request(app).get(`/unknown/user${index}`);
    }
    const values = (await httpRequestCounter.get()).values;

    expect(values).toHaveLength(2);
    expect(values.map((value) => value.value)).toEqual([35, 35]);
    expect(values.map((value) => value.labels.route)).toEqual([
      '/api/v1/items/:id',
      '<unmatched>',
    ]);
  });

  it.each([false, true])(
    'records a client disconnect once with headersSent=%s',
    async (sendHeaders) => {
      const { app, access } = fixture();
      const started = deferred();

      app.get('/hold', (_req, res) => {
        if (sendHeaders) res.write('partial');
        started.resolve();
      });
      const server = await listen(app);
      const client = get({
        host: '127.0.0.1',
        port: portOf(server),
        path: '/hold',
      });

      client.on('error', () => undefined);
      try {
        if (sendHeaders) {
          await new Promise<void>((resolve) =>
            client.once('response', (response) => {
              response.on('error', () => undefined);
              response.once('data', () => resolve());
            }),
          );
        } else await started.promise;
        client.destroy();
        await vi.waitFor(() => expect(access()).toHaveLength(1));
        expect(access()[0]).toMatchObject({
          outcome: 'aborted',
          headersSent: sendHeaders,
          route: '/hold',
          level: 'warn',
          message: expect.stringMatching(/^ABORTED GET/),
        });
        if (sendHeaders) expect(access()[0].status).toBe(200);
        else expect(access()[0]).not.toHaveProperty('status');
        expect(await counts()).toEqual({ completed: 0, aborted: 1 });
        expect((await httpRequestDuration.get()).values).toEqual([]);
        expect(
          (await httpRequestAbortedCounter.get()).values[0].labels,
        ).toEqual({ method: 'GET', route: '/hold' });
      } finally {
        client.destroy();
      }
    },
  );

  it('records an aborted upload before routing without exposing its URL', async () => {
    const { app, access } = fixture();
    const receiving = deferred();

    app.use((_req, _res, next) => {
      receiving.resolve();
      next();
    });
    app.use(express.json());
    app.post('/upload', (_req, res) => res.end());
    app.use(errorHandler);
    const server = await listen(app);
    const client = httpRequest({
      host: '127.0.0.1',
      port: portOf(server),
      path: '/upload?token=private-query',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': '1000' },
    });

    client.on('error', () => undefined);
    try {
      client.write('{"partial":');
      await receiving.promise;
      client.destroy();
      await vi.waitFor(() => expect(access()).toHaveLength(1));
      expect(access()[0]).toMatchObject({
        outcome: 'aborted',
        method: 'POST',
        route: '<unmatched>',
      });
      expect(JSON.stringify(access())).not.toContain('private-query');
      expect(await counts()).toEqual({ completed: 0, aborted: 1 });
    } finally {
      client.destroy();
    }
  });

  it('counts a sent processing deadline as completed and an interrupted partial response as aborted', async () => {
    const { app, access } = fixture();

    app.use(requestTimeout(20));
    app.get('/timeout', () => undefined);
    app.get('/partial', (_req, res) => {
      res.write('partial');
    });
    app.use(errorHandler);
    expect((await request(app).get('/timeout')).status).toBe(408);
    await expect(request(app).get('/partial')).rejects.toThrow();
    await vi.waitFor(() => expect(access()).toHaveLength(2));
    expect(access().map((entry) => [entry.outcome, entry.status])).toEqual([
      ['completed', 408],
      ['aborted', 200],
    ]);
    expect(await counts()).toEqual({ completed: 1, aborted: 1 });
  });

  it('distinguishes identical local paths under different declared router mounts', async () => {
    const { app } = fixture();

    for (const prefix of ['/first', '/second']) {
      const router = express.Router();

      router.get('/:id', (_req, res) => res.end());
      app.use(prefix, logRoute({ prefix }), router);
    }
    await request(app).get('/first/private-item');
    await request(app).get('/second/private-item');
    expect(
      (await httpRequestCounter.get()).values.map(
        (value) => value.labels.route,
      ),
    ).toEqual(['/first/:id', '/second/:id']);
  });

  it('records each completed request once across a real keep-alive connection', async () => {
    const { app, access } = fixture();
    const connections = new Set<number | undefined>();
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });

    agents.push(agent);
    app.set('trust proxy', ['127.0.0.1/8', '::1/128']);
    app.get('/keep-alive', (req, res) => {
      connections.add(req.socket.remotePort);
      res.end();
    });
    const server = await listen(app);

    for (let index = 0; index < 25; index++) {
      await new Promise<void>((resolve, reject) => {
        get(
          {
            host: '127.0.0.1',
            port: portOf(server),
            path: '/keep-alive',
            agent,
            headers: { 'X-Forwarded-For': `192.0.2.${index + 1}` },
          },
          (response) => {
            response.on('error', reject);
            response.on('end', resolve);
            response.resume();
          },
        ).on('error', reject);
      });
    }
    expect(connections.size).toBe(1);
    expect(access()).toHaveLength(25);
    expect(await counts()).toEqual({ completed: 25, aborted: 0 });
    expect(new Set(access().map((entry) => entry.requestId)).size).toBe(25);
    expect(access().map((entry) => entry.ip)).toEqual(
      Array.from({ length: 25 }, (_, index) => `192.0.2.${index + 1}`),
    );
  });
});
