import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '@/config/http-server.config';
import { metricsRegistry } from '@/config/metrics.config';
import {
  connectTestDatabase,
  disconnectTestDatabase,
  resetTestDatabase,
} from '../helpers/database/database';

const app = createApp();

beforeAll(connectTestDatabase);
beforeEach(async () => {
  await resetTestDatabase();
  metricsRegistry.resetMetrics();
});
afterAll(disconnectTestDatabase);

describe('items API with real middleware, controller, DTOs, and repository', () => {
  it('runs create, read, patch, replacement, listing, and delete through the HTTP stack', async () => {
    const created = await request(app)
      .post('/api/items')
      .type('json')
      .send({ name: 'Travel Pack', description: 'canvas bag', price: 25 });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      name: 'Travel Pack',
      description: 'canvas bag',
      price: 25,
    });
    expect(created.body.createdAt).toBeTruthy();

    const fetched = await request(app).get(`/api/items/${created.body.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body).toEqual(created.body);

    const patched = await request(app)
      .patch(`/api/items/${created.body.id}`)
      .type('json')
      .send({ price: 29 });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({
      name: 'Travel Pack',
      description: 'canvas bag',
      price: 29,
    });

    const replaced = await request(app)
      .put(`/api/items/${created.body.id}`)
      .type('json')
      .send({ name: 'Replacement Pack', price: 31 });
    expect(replaced.status).toBe(200);
    expect(replaced.body).toMatchObject({ name: 'Replacement Pack', description: null, price: 31 });

    const listed = await request(app).get('/api/items?page=1&limit=10&search=Replacement');
    expect(listed.status).toBe(200);
    expect(listed.body).toMatchObject({ total: 1, page: 1, limit: 10 });
    expect(listed.body.data).toEqual([replaced.body]);

    const deleted = await request(app).delete(`/api/items/${created.body.id}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body.id).toBe(created.body.id);
    expect((await request(app).get(`/api/items/${created.body.id}`)).status).toBe(404);
  });

  it('proves validation executes before the controller and returns the stable error DTO', async () => {
    const invalid = await request(app)
      .post('/api/items')
      .type('json')
      .send({ name: '', price: -1 });

    expect(invalid.status).toBe(422);
    expect(invalid.headers['x-request-id']).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(invalid.body).toEqual({
      status: 422,
      message: expect.stringContaining('body.name'),
      timestamp: expect.any(Number),
    });
    expect((await request(app).get('/api/items')).body.total).toBe(0);
  });

  it('propagates an async controller error to the final error middleware with stable mapping', async () => {
    const missing = await request(app).get('/api/items/1234567890abcdef');

    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({
      status: 404,
      message: 'No item exists with the provided identifier.',
      timestamp: expect.any(Number),
    });
    expect(missing.headers['x-request-id']).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('exposes request metrics after routed and failed requests', async () => {
    await request(app).get('/api/items');
    await request(app).get('/api/items/1234567890abcdef');

    const metrics = await request(app).get('/metrics');
    expect(metrics.status).toBe(200);
    expect(metrics.headers['content-type']).toContain('text/plain');
    expect(metrics.text).toContain('http_requests_total');
    expect(metrics.text).toContain('method="GET"');
    expect(metrics.text).toContain('status="200"');
    expect(metrics.text).toContain('status="404"');
  });

  it('keeps context before policy/body parsing and error handling last in the composed app', async () => {
    const malformed = await request(app).post('/api/items').type('json').send('{"broken":');

    expect(malformed.status).toBe(400);
    expect(malformed.body.message).toBe('Malformed JSON request body.');
    expect(malformed.headers['x-request-id']).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(malformed.headers['x-body-limit-bytes']).toBe('1048576');
  });
});
