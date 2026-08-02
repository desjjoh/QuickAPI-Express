import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { logger } from '@/config/logger.config';
import { errorHandler } from '@/common/middleware/error-handler.middleware';
import { bodyLimitMiddleware } from '@/common/middleware/request-body-limit.middleware';

function createTestApp(limit = 32) {
  const app = express();

  app.use(bodyLimitMiddleware({ defaultLimit: limit }));
  app.post('/body', (req, res) => res.json(req.body));
  app.get('/failure', () => {
    throw new Error('database connection password=secret');
  });
  app.use(errorHandler);

  return app;
}

describe('request body parsing and error handling', () => {
  it('parses JSON once and reports the remaining body allowance', async () => {
    const body = JSON.stringify({ ok: true });
    const response = await request(createTestApp()).post('/body').type('json').send(body);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(response.headers['x-body-limit-bytes']).toBe('32');
    expect(response.headers['x-body-remaining-bytes']).toBe(String(32 - Buffer.byteLength(body)));
  });

  it('returns a stable 400 response for malformed JSON', async () => {
    const response = await request(createTestApp()).post('/body').type('json').send('{"broken":');

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Malformed JSON request body.');
    expect(response.body.message).not.toContain('Unexpected end');
  });

  it('maps an oversized parser failure to the public 413 error and limit metadata', async () => {
    const response = await request(createTestApp(16))
      .post('/body')
      .type('json')
      .send(JSON.stringify({ value: 'far too large' }));

    expect(response.status).toBe(413);
    expect(response.body.message).toBe('Request body exceeds maximum allowed size (limit = 16 B).');
    expect(response.headers['x-body-limit-bytes']).toBe('16');
    expect(response.headers['x-body-remaining-bytes']).toBe('0');
  });

  it('logs unexpected failures but does not expose their details', async () => {
    const log = vi.spyOn(logger, 'error').mockImplementation(() => logger);
    const response = await request(createTestApp()).get('/failure');

    expect(response.status).toBe(500);
    expect(response.body.message).toBe('Internal Server Error');
    expect(JSON.stringify(response.body)).not.toContain('password=secret');
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        errorType: 'Error',
        stack: expect.stringContaining('database connection password=secret'),
        status: 500,
      }),
      'database connection password=secret',
    );

    log.mockRestore();
  });
});
