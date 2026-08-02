import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { HttpError, ValidationError } from '@/common/exceptions/http.exception';
import { errorHandler } from '@/common/middleware/error-handler.middleware';
import { validateRequest } from '@/common/middleware/validate-request.middleware';
import { logger } from '@/config/logger.config';

function response() {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}

describe('validateRequest', () => {
  const schemas = {
    params: z.object({ id: z.coerce.number().int() }),
    query: z.object({ enabled: z.enum(['yes', 'no']) }),
    body: z.object({ name: z.string().min(2) }),
  };

  it('stores parsed values from every request location', () => {
    const req = { params: { id: '7' }, query: { enabled: 'yes' }, body: { name: 'ok' } };
    const next = vi.fn();

    validateRequest(schemas)(req as never, {} as never, next);

    expect(req).toHaveProperty('validated', {
      params: { id: 7 },
      query: { enabled: 'yes' },
      body: { name: 'ok' },
    });
    expect(next).toHaveBeenCalledOnce();
  });

  it.each([
    ['params', { params: { id: 'bad' }, query: { enabled: 'yes' }, body: { name: 'ok' } }],
    ['query', { params: { id: '7' }, query: { enabled: 'maybe' }, body: { name: 'ok' } }],
    ['body', { params: { id: '7' }, query: { enabled: 'yes' }, body: { name: '' } }],
  ])('reports invalid %s input as a validation error', (_location, req) => {
    expect(() => validateRequest(schemas)(req as never, {} as never, vi.fn())).toThrow(
      ValidationError,
    );
  });

  it('supports an empty schema set', () => {
    const req = { params: {}, query: {}, body: {} };
    const next = vi.fn();
    validateRequest({})(req as never, {} as never, next);
    expect(req).toHaveProperty('validated', { params: null, query: null, body: null });
    expect(next).toHaveBeenCalledOnce();
  });
});

describe('errorHandler', () => {
  it('returns and logs a public HTTP error', () => {
    const res = response();
    const warning = vi.spyOn(logger, 'warn').mockImplementation(() => logger);

    errorHandler(new HttpError(409, 'Conflict', 'CONFLICT'), {} as never, res as never, vi.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Conflict' }));
    expect(warning).toHaveBeenCalledWith({ status: 409, code: 'CONFLICT' }, 'Conflict');
  });

  it('formats Zod errors without exposing internals', () => {
    const res = response();
    const result = z.object({ name: z.string().min(2) }).safeParse({ name: '' });
    if (result.success) throw new Error('Expected invalid fixture');

    errorHandler(result.error, {} as never, res as never, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('name') }),
    );
  });

  it('hides unexpected errors and non-error thrown values', () => {
    const log = vi.spyOn(logger, 'error').mockImplementation(() => logger);

    for (const thrown of [new Error('secret'), 'secret']) {
      const res = response();
      errorHandler(thrown, {} as never, res as never, vi.fn());
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Internal Server Error' }),
      );
    }
    expect(log).toHaveBeenCalledTimes(2);
  });
});
