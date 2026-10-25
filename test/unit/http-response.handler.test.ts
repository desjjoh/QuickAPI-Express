import express from 'express';
import request from 'supertest';
import { ItemPaginationQuerySchema } from '@/api/v1/items/models/pagination-query.model';
import { validateRequest } from '@/common/middleware/validate-request.middleware';
import { ItemService } from '@/api/v1/items/services/items.service';
import { get } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  jsonHandler,
  textHandler,
} from '@/common/handlers/http-response.handler';
import { RequestWorkTracker } from '@/common/handlers/request-lifecycle.handler';
import { requestTimeout } from '@/common/middleware/request-timeout.middleware';
import { errorHandler } from '@/common/middleware/error-handler.middleware';
import { NotFoundError } from '@/common/exceptions/http.exception';
import { logger } from '@/config/logger.config';
import {
  currentRequestContext,
  type RequestContext,
} from '@/common/helpers/request-context.helper';
import { deferred, portOf } from '../helpers/http';

afterEach(() => vi.restoreAllMocks());

function fixture() {
  const app = express();
  const work = new RequestWorkTracker();
  app.use(work.admit, requestTimeout(40));
  return { app, work };
}

describe('shared HTTP response adapter', () => {
  it('returns 408 when a boundary observes clock expiry before the timer fires', async () => {
    const { app } = fixture();
    app.get(
      '/',
      jsonHandler(
        () => {
          const context = currentRequestContext()!;
          context.setDeadline(0);
          context.assertActive();
          return 1;
        },
        (value) => value,
      ),
    );
    app.use(errorHandler);
    expect((await request(app).get('/')).status).toBe(408);
  });

  it('passes parsed values to a detached service method without exposing the request', async () => {
    const { app } = fixture();
    const repository = {
      transaction: vi.fn(),
      create: vi.fn(),
      get_many: vi.fn().mockResolvedValue([]),
      get_by_id: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    };
    const service = new ItemService(repository);
    app.get(
      '/',
      validateRequest({ query: ItemPaginationQuerySchema }),
      jsonHandler(service.list, (items) => items),
    );
    app.use(errorHandler);

    const result = await request(app).get('/?limit=2&page=1&ignored=raw');

    expect(result.status).toBe(200);
    expect(repository.get_many).toHaveBeenCalledExactlyOnceWith({
      limit: 2,
      page: 1,
    });
  });

  it('owns JSON mapping, fixed/dynamic status, text content type, and error forwarding', async () => {
    const { app } = fixture();
    app.get(
      '/created',
      jsonHandler(
        () => 3,
        (value) => ({ value }),
        { status: 201 },
      ),
    );
    app.get(
      '/unavailable',
      jsonHandler(
        () => ({ ready: false }),
        (value) => value,
        { status: (value) => (value.ready ? 200 : 503) },
      ),
    );
    app.get(
      '/text',
      textHandler(() => 'metric 1\n', 'text/plain; version=0.0.4'),
    );
    app.get(
      '/missing',
      jsonHandler(
        () => {
          throw new NotFoundError('Missing item.');
        },
        (value) => value,
      ),
    );
    app.get(
      '/invalid-output',
      jsonHandler(
        () => 1,
        () => {
          throw new Error('Private DTO details');
        },
      ),
    );
    app.use(errorHandler);
    const created = await request(app).get('/created');
    expect(created.status).toBe(201);
    expect(created.body).toEqual({ value: 3 });
    expect((await request(app).get('/unavailable')).status).toBe(503);
    const text = await request(app).get('/text');
    expect(text.text).toBe('metric 1\n');
    expect(text.headers['content-type']).toContain('version=0.0.4');
    expect((await request(app).get('/missing')).status).toBe(404);
    const invalid = await request(app).get('/invalid-output');
    expect(invalid.status).toBe(500);
    expect(invalid.body.message).toBe('Internal Server Error');
  });

  it('aborts the operation and skips late DTO mapping while tracking work past a deadline', async () => {
    const { app, work } = fixture();
    const finish = deferred<number>();
    const began = deferred();
    let operation: RequestContext | undefined;
    const map = vi.fn((value: number) => ({ value }));
    app.get(
      '/',
      jsonHandler(() => {
        operation = currentRequestContext();
        began.resolve();
        return finish.promise;
      }, map),
    );
    app.use(errorHandler);
    const pending = request(app)
      .get('/')
      .then((result) => result);
    try {
      await began.promise;
      expect((await pending).status).toBe(408);
      expect(operation?.signal.aborted).toBe(true);
      let drained = false;
      const draining = work.drain().then(() => {
        drained = true;
      });
      await Promise.resolve();
      expect(drained).toBe(false);
      finish.resolve(3);
      await draining;
      expect(map).not.toHaveBeenCalled();
    } finally {
      finish.resolve(3);
      await work.drain();
    }
  });

  it('observes genuine late rejection without sending or mapping another response', async () => {
    const { app, work } = fixture();
    const finish = deferred<number>();
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const map = vi.fn((value: number) => value);
    app.get(
      '/',
      jsonHandler(() => finish.promise, map),
    );
    app.use(errorHandler);
    try {
      expect((await request(app).get('/')).status).toBe(408);
      finish.reject(new Error('Late database rejection'));
      await work.drain();
      expect(map).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledExactlyOnceWith(
        expect.any(Object),
        'Request work failed after its response closed.',
      );
    } finally {
      finish.resolve(1);
      await work.drain();
    }
  });

  it('cooperatively stops an abandoned next step without logging it as a late failure', async () => {
    const { app, work } = fixture();
    const finish = deferred();
    const began = deferred();
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    app.get(
      '/',
      jsonHandler(
        async () => {
          const operation = currentRequestContext()!;
          began.resolve();
          await finish.promise;
          operation.assertActive();
          return 1;
        },
        (value) => value,
      ),
    );
    app.use(errorHandler);
    const pending = request(app)
      .get('/')
      .then((result) => result);
    try {
      await began.promise;
      expect((await pending).status).toBe(408);
      finish.resolve();
      await work.drain();
      expect(error).not.toHaveBeenCalled();
    } finally {
      finish.resolve();
      await work.drain();
    }
  });

  it('aborts on disconnect and drains the controller before skipping its response', async () => {
    const { app, work } = fixture();
    const finish = deferred<number>();
    const began = deferred<RequestContext>();
    const abandoned = deferred();
    const map = vi.fn((value: number) => value);
    app.get(
      '/',
      jsonHandler(() => {
        const operation = currentRequestContext()!;
        operation.signal.addEventListener('abort', () => abandoned.resolve(), {
          once: true,
        });
        began.resolve(operation);
        return finish.promise;
      }, map),
    );
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const client = get({ host: '127.0.0.1', port: portOf(server), path: '/' });
    client.on('error', () => undefined);
    try {
      const operation = await began.promise;
      client.destroy();
      await abandoned.promise;
      expect(operation.signal.aborted).toBe(true);
      finish.resolve(3);
      await work.drain();
      expect(map).not.toHaveBeenCalled();
    } finally {
      client.destroy();
      finish.resolve(3);
      await work.drain();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
