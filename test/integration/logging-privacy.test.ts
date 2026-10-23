import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLogger, logger } from '@/config/logger.config';
import { createApp } from '@/config/http-server.config';
import { env } from '@/config/env.config';
import { httpLogger } from '@/common/middleware/http-logger.middleware';
import { requestContextMiddleware } from '@/common/middleware/request-context.middleware';
import { errorHandler } from '@/common/middleware/error-handler.middleware';
import { requestTimeout } from '@/common/middleware/request-timeout.middleware';
import { RequestContext } from '@/common/store/request-context.store';
import { logRoute } from '@/common/helpers/request-log.helper';
import { trackHandler } from '@/common/handlers/request-lifecycle.handler';
import { deferred } from '../helpers/http';

vi.mock('@/database/repositories/item.repo', () => ({
  itemRepository: { get_by_id: vi.fn(async () => null) },
}));

afterEach(() => vi.restoreAllMocks());

function capture() {
  const lines: string[] = [];
  const output = createLogger(
    { production: true, level: 'debug' },
    {
      write: (line) => {
        lines.push(line);
      },
    },
  );

  for (const level of ['debug', 'info', 'warn', 'error', 'fatal'] as const) {
    vi.spyOn(logger, level).mockImplementation(
      (bindings: unknown, message?: string) => {
        output[level](bindings as object, message);
      },
    );
  }

  return { lines, entries: () => lines.map((line) => JSON.parse(line)) };
}

describe('request logging privacy', () => {
  it('sanitizes failures delegated to Express after headers have been sent', async () => {
    const { lines, entries } = capture();
    const stderr = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const app = express();

    app.set('env', 'development');
    app.use(requestContextMiddleware, httpLogger);
    app.get('/stream', (_req, res, next) => {
      res.write('partial');
      next(new Error('private-stream-password'));
    });
    app.use(errorHandler);
    await expect(request(app).get('/stream')).rejects.toThrow();
    await vi.waitFor(() => expect(stderr).toHaveBeenCalled());
    await vi.waitFor(() =>
      expect(
        entries().find(
          (entry) => entry.route === '/stream' && entry.outcome === 'aborted',
        ),
      ).toBeDefined(),
    );
    expect(
      entries().find(
        (entry) => entry.msg === 'Response failed after headers were sent.',
      ).error,
    ).toMatchObject({ errorType: 'Error' });
    expect(lines.join('')).not.toContain('private-stream-password');
    expect(JSON.stringify(stderr.mock.calls)).not.toContain(
      'private-stream-password',
    );
  });

  it('logs full item templates and unknown-route fallback without URL secrets', async () => {
    const { lines, entries } = capture();
    const app = createApp();
    const item = await request(app).get(
      '/api/v1/items/PrivateItem00001?token=private-query',
    );
    const missing = await request(app).get(
      '/unknown/private-email@example.test?token=private-query',
    );

    expect(item.status).toBe(404);
    expect(missing.status).toBe(404);
    const access = entries().filter((entry) => entry.route);

    expect(access.map((entry) => entry.route)).toEqual([
      '/api/v1/items/:id',
      '<unmatched>',
    ]);
    expect(access[0].msg).toMatch(
      /^404 GET\s+\/api\/v1\/items\/:id\s+\d+\.\d{2}ms$/,
    );
    expect(access[0]).toMatchObject({
      levelLabel: 'warn',
      status: 404,
      requestId: item.headers['x-request-id'],
    });
    expect(lines.join('')).not.toMatch(
      /PrivateItem00001|private-query|private-email|token=/,
    );
  });

  it('uses debug for success, warn for policy rejection, and error for failures', async () => {
    const { lines, entries } = capture();
    const app = express();

    app.use(requestContextMiddleware, httpLogger);
    app.get('/ok', (_req, res) => res.json({ ok: true }));
    app.get('/failure', () => {
      throw new Error('private-sql-password');
    });
    app.use(errorHandler);
    expect((await request(app).get('/ok')).status).toBe(200);
    expect((await request(app).get('/failure')).status).toBe(500);
    const limited = createApp({ ...env, RATE_LIMIT_MAX: 1 });

    await request(limited).get('/health');
    expect((await request(limited).get('/health')).status).toBe(429);
    expect(
      entries()
        .filter((entry) => entry.route)
        .map((entry) => [entry.status, entry.levelLabel]),
    ).toEqual([
      [200, 'debug'],
      [500, 'error'],
      [200, 'debug'],
      [429, 'warn'],
    ]);
    expect(lines.join('')).not.toContain('private-sql-password');
  });

  it('keeps request correlation isolated across overlapping asynchronous handlers', async () => {
    const { entries } = capture();
    const started = deferred();
    const release = deferred();
    const app = express();
    let firstId: string | undefined;

    app.use(requestContextMiddleware, httpLogger);
    app.get('/first', async (_req, res) => {
      firstId = RequestContext.getId();
      started.resolve();
      await release.promise;
      logger.info({ stage: 'first' }, 'Handler resumed.');
      res.json({ requestId: RequestContext.getId() });
    });
    app.get('/second', (_req, res) => {
      logger.info({ stage: 'second' }, 'Handler resumed.');
      res.json({ requestId: RequestContext.getId() });
    });
    const first = request(app)
      .get('/first')
      .then((response) => response);

    try {
      await started.promise;
      const second = await request(app).get('/second');

      release.resolve();
      const response = await first;

      expect(response.body.requestId).toBe(firstId);
      expect(second.body.requestId).not.toBe(firstId);
      expect(entries().find((entry) => entry.stage === 'first').requestId).toBe(
        firstId,
      );
      expect(
        entries().find((entry) => entry.stage === 'second').requestId,
      ).toBe(second.body.requestId);
      expect(
        entries().find((entry) => entry.route === '/first').requestId,
      ).toBe(firstId);
      expect(RequestContext.get()).toBeUndefined();
    } finally {
      release.resolve();
      await first;
    }
  });

  it('does not use concrete dynamic mount values as route names', async () => {
    const { lines, entries } = capture();
    const app = express();
    const router = express.Router();

    app.use(requestContextMiddleware, httpLogger);
    router.get('/:id', (_req, res) => res.end());
    app.use(
      '/accounts/:accountId',
      logRoute({ prefix: '/accounts/:accountId' }),
      router,
    );
    await request(app).get(
      '/accounts/private-account/private-item?token=private-query',
    );
    expect(entries()[0].route).toBe('/accounts/:accountId/:id');
    expect(lines.join('')).not.toMatch(
      /private-account|private-item|private-query/,
    );
  });

  it('safely records a late handler failure after the response deadline', async () => {
    const { lines, entries } = capture();
    const release = deferred();
    const app = express();

    app.use(requestContextMiddleware, httpLogger, requestTimeout(20));
    app.get(
      '/slow',
      trackHandler(async () => {
        await release.promise;
        throw new Error('private-late-sql');
      }),
    );
    app.use(errorHandler);
    const response = await request(app).get('/slow');

    expect(response.status).toBe(408);
    release.resolve();
    await vi.waitFor(() =>
      expect(
        entries().find(
          (entry) =>
            entry.msg === 'Request work failed after its response closed.',
        ),
      ).toBeDefined(),
    );
    expect(entries().filter((entry) => entry.route)).toHaveLength(1);
    expect(
      entries().find(
        (entry) =>
          entry.msg === 'Request work failed after its response closed.',
      ),
    ).toMatchObject({
      requestId: response.headers['x-request-id'],
      error: { errorType: 'Error' },
    });
    expect(lines.join('')).not.toContain('private-late-sql');
  });
});
