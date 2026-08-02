import type { Server } from 'node:http';

import request, { type Response } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '@/config/http-server.config';
import { AppDataSource } from '@/config/database.config';
import { LC, type LifecycleService } from '@/common/handlers/lifecycle.handler';
import { metricsRegistry } from '@/config/metrics.config';
import {
  connectTestDatabase,
  disconnectTestDatabase,
  resetTestDatabase,
} from '../helpers/database/database';

type DependencyState = 'healthy' | 'unhealthy' | 'throw';

let server: Server;
let dependencyState: DependencyState = 'healthy';
let healthBeforeStartup: Response;
let readyBeforeStartup: Response;

function expectRequestHeaders(response: Response): void {
  expect(response.headers['x-request-id']).toMatch(/^[A-Za-z0-9_-]+$/);
  expect(response.headers['x-powered-by']).toBeUndefined();
  expect(response.headers['x-content-type-options']).toBe('nosniff');
  expect(response.headers['x-frame-options']).toBe('DENY');
  expect(response.headers['content-security-policy']).toContain("default-src 'self'");
}

function expectJson(response: Response): void {
  expect(response.headers['content-type']).toMatch(/^application\/json\b/);
}

function expectError(response: Response, status: number): void {
  expect(response.status).toBe(status);
  expectJson(response);
  expectRequestHeaders(response);
  expect(response.body).toEqual({
    status,
    message: expect.any(String),
    timestamp: expect.any(Number),
  });
}

beforeAll(async () => {
  server = createApp().listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  // Capture probes against the listening application before lifecycle startup.
  healthBeforeStartup = await request(server).get('/health');
  readyBeforeStartup = await request(server).get('/ready');

  const database: LifecycleService = {
    name: 'disposable migrated mysql',
    start: connectTestDatabase,
    stop: disconnectTestDatabase,
    check: async () => {
      if (dependencyState === 'throw') throw new Error('deliberate readiness check failure');
      return dependencyState === 'healthy' && AppDataSource.isInitialized;
    },
  };
  const http: LifecycleService = {
    name: 'ephemeral express listener',
    check: () => server.listening,
  };

  LC.register([database, http]);
  await LC.startup();
});

beforeEach(async () => {
  dependencyState = 'healthy';
  await resetTestDatabase();
  metricsRegistry.resetMetrics();
});

afterAll(async () => {
  await LC.shutdown();
  if (server?.listening) {
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve())),
    );
  }
});

describe('real application probes', () => {
  it('keeps liveness independent from startup and dependency readiness', () => {
    expect(healthBeforeStartup.status).toBe(200);
    expect(healthBeforeStartup.body).toMatchObject({ alive: true });
    expect(healthBeforeStartup.body.uptime).toBeTypeOf('number');
    expect(healthBeforeStartup.body.timestamp).toBeTypeOf('string');
    expectRequestHeaders(healthBeforeStartup);

    expectError(readyBeforeStartup, 503);
  });

  it('reports ready after startup', async () => {
    const response = await request(server).get('/ready');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ready: true });
    expectJson(response);
    expectRequestHeaders(response);
  });

  it.each(['unhealthy', 'throw'] as const)(
    'reports not ready when a dependency is %s',
    async state => {
      dependencyState = state;
      const response = await request(server).get('/ready');

      expectError(response, 503);
      expect(response.body.message).toBe('Application not ready');
      expect((await request(server).get('/health')).body.alive).toBe(true);
    },
  );
});

describe('real item API', () => {
  it('covers create, list, get, patch, put, and delete with deterministic data', async () => {
    const created = await request(server)
      .post('/api/items')
      .type('json')
      .send({ name: 'Fixture Alpha', description: 'first fixture', price: 120 });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      id: expect.stringMatching(/^[A-Za-z0-9]{16}$/),
      name: 'Fixture Alpha',
      description: 'first fixture',
      price: 120,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expectJson(created);
    expectRequestHeaders(created);

    const fetched = await request(server).get(`/api/items/${created.body.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body).toEqual(created.body);

    const patched = await request(server)
      .patch(`/api/items/${created.body.id}`)
      .type('json')
      .send({ price: 125 });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ name: 'Fixture Alpha', price: 125 });

    const replaced = await request(server)
      .put(`/api/items/${created.body.id}`)
      .type('json')
      .send({ name: 'Fixture Replacement', price: 130 });
    expect(replaced.status).toBe(200);
    expect(replaced.body).toMatchObject({
      name: 'Fixture Replacement',
      description: null,
      price: 130,
    });

    const listed = await request(server).get(
      '/api/v1/items?page=1&limit=5&search=Replacement&sort=price&order=asc&min_price=100&max_price=150',
    );
    expect(listed.status).toBe(200);
    expect(listed.body).toMatchObject({ total: 1, page: 1, limit: 5, data: [replaced.body] });

    const deleted = await request(server).delete(`/api/items/${created.body.id}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body.id).toBe(created.body.id);
    expectError(await request(server).get(`/api/items/${created.body.id}`), 404);
  });

  it.each([
    [
      'invalid create body',
      () => request(server).post('/api/items').type('json').send({ name: '', price: -1 }),
    ],
    [
      'invalid patch body',
      () => request(server).patch('/api/items/1234567890abcdef').type('json').send({}),
    ],
    ['invalid id', () => request(server).get('/api/items/not-an-id')],
    ['invalid page', () => request(server).get('/api/items?page=0')],
    ['invalid filter', () => request(server).get('/api/items?min_price=20&max_price=10')],
  ])('rejects %s', async (_name, send) => {
    expectError(await send(), 422);
  });

  it('returns the common error contract for missing resources and unknown routes', async () => {
    expectError(await request(server).get('/api/items/1234567890abcdef'), 404);
    const unknown = await request(server).get('/does-not-exist');
    expectError(unknown, 404);
    expect(unknown.body.message).toContain('GET /does-not-exist');
  });

  it('rejects malformed JSON, oversized bodies, content types, and methods', async () => {
    expectError(await request(server).post('/api/items').type('json').send('{"broken":'), 400);

    const oversized = await request(server)
      .post('/api/items')
      .type('json')
      .send({ name: 'x'.repeat(1_048_577), price: 1 });
    expectError(oversized, 413);
    expect(oversized.headers['x-body-remaining-bytes']).toBe('0');

    expectError(await request(server).post('/api/items').type('text').send('not json'), 415);
    expectError(await request(server).trace('/api/items'), 405);
  });

  it('redacts a safely induced persistence error', async () => {
    await AppDataSource.query('RENAME TABLE `items` TO `items_e2e_failure`');
    let response: Response;
    try {
      response = await request(server)
        .post('/api/items')
        .type('json')
        .send({ name: 'Will Fail', price: 10 });
    } finally {
      await AppDataSource.query('RENAME TABLE `items_e2e_failure` TO `items`');
    }

    expectError(response!, 500);
    expect(response!.body.message).toBe('Internal Server Error');
    expect(JSON.stringify(response!.body)).not.toMatch(/items|query|mysql|Will Fail/i);
  });
});
