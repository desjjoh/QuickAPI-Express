import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { validateRequest } from '@/common/middleware/validate-request.middleware';
import { errorHandler } from '@/common/middleware/error-handler.middleware';

function app() {
  const app = express();
  app.use(express.json());
  app.post(
    '/items/:id',
    validateRequest({
      params: z.object({ id: z.coerce.number().int() }),
      query: z.object({ active: z.enum(['yes', 'no']) }),
      body: z.object({ name: z.string().min(1) }),
    }),
    (req, res) => res.json(req.validated),
  );
  app.use(errorHandler);
  return app;
}

describe('request validation', () => {
  it('stores parsed params, query, and body for handlers', async () => {
    const response = await request(app()).post('/items/42?active=yes').send({ name: 'item' });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      params: { id: 42 },
      query: { active: 'yes' },
      body: { name: 'item' },
    });
  });
  it.each([
    ['/items/nope?active=yes', { name: 'item' }, 'path.id'],
    ['/items/42?active=maybe', { name: 'item' }, 'query.active'],
    ['/items/42?active=yes', { name: '' }, 'body.name'],
  ] as const)('returns useful validation failures for %s', async (url, body, field) => {
    const response = await request(app()).post(url).send(body);
    expect(response.status).toBe(422);
    expect(response.body.message).toContain(field);
  });
});
