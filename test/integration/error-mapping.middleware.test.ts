import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import { logger } from '@/config/logger.config';
import { HttpError } from '@/common/exceptions/http.exception';
import { errorHandler } from '@/common/middleware/error-handler.middleware';

function app(error: unknown) {
  const app = express();
  app.get('/', () => {
    throw error;
  });
  app.use(errorHandler);
  return app;
}

describe('error mapping', () => {
  it('preserves public HttpError status/message/code and uses warning severity', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    const error = new HttpError(409, 'conflict', 'DUPLICATE');
    const response = await request(app(error)).get('/');
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ status: 409, message: 'conflict' });
    expect(warn).toHaveBeenCalledWith({ status: 409, code: 'DUPLICATE' }, 'conflict');
    warn.mockRestore();
  });
  it('preserves an explicitly public server-side HttpError message', async () => {
    const log = vi.spyOn(logger, 'error').mockImplementation(() => logger);
    const response = await request(app(new HttpError(503, 'temporarily unavailable'))).get('/');
    expect(response.status).toBe(503);
    expect(response.body.message).toBe('temporarily unavailable');
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
  it('formats Zod failures as client errors', async () => {
    const failure = z.object({ count: z.number() }).safeParse({ count: 'no' });
    if (failure.success) throw new Error('expected failure');
    const response = await request(app(failure.error)).get('/');
    expect(response.status).toBe(400);
    expect(response.body.message).toContain('count');
  });
  it('redacts unknown failure details from responses and logs at error severity', async () => {
    const log = vi.spyOn(logger, 'error').mockImplementation(() => logger);
    const response = await request(app('password=secret')).get('/');
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('secret');
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
