import express from 'express';
import request from 'supertest';
import { Agent, get } from 'node:http';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpListener } from '@/common/handlers/http-lifecycle.handler';
import {
  RequestWorkTracker,
  canRespond,
  trackHandler,
} from '@/common/handlers/request-lifecycle.handler';
import { requestTimeout } from '@/common/middleware/request-timeout.middleware';
import { errorHandler } from '@/common/middleware/error-handler.middleware';
import { env } from '@/config/env.config';
import { deferred, portOf, rawRequest } from '../helpers/http';

const listeners: HttpListener[] = [];
afterEach(async () => {
  await Promise.all(
    listeners
      .splice(0)
      .map((listener) => listener.close().catch(() => undefined)),
  );
});

function fixture(timeout = 1_000, drain = 1_000) {
  const work = new RequestWorkTracker();
  const app = express();
  app.use(work.admit);
  app.use(requestTimeout(timeout));
  const listener = new HttpListener(app, work, {
    ...env,
    HTTP_HEADERS_TIMEOUT_MS: 80,
    HTTP_REQUEST_TIMEOUT_MS: 160,
    HTTP_DRAIN_TIMEOUT_MS: drain,
  });
  listeners.push(listener);
  return { app, listener, work };
}

describe('HTTP listener and response lifecycle', () => {
  it('awaits binding, shares startup/close promises, rejects occupied ports, and cleans up failed starts', async () => {
    const first = fixture();
    const start = first.listener.start(0, '127.0.0.1');
    expect(first.listener.start(0)).toBe(start);
    expect(first.listener.isRunning()).toBe(false);
    await start;
    expect(first.listener.isRunning()).toBe(true);
    const occupied = fixture();
    await expect(
      occupied.listener.start(portOf(first.listener.server), '127.0.0.1'),
    ).rejects.toMatchObject({ code: 'EADDRINUSE' });
    await occupied.listener.close();
    expect(occupied.listener.isRunning()).toBe(false);
    const close = first.listener.close();
    expect(first.listener.isRunning()).toBe(false);
    expect(first.listener.close()).toBe(close);
    await close;
    const retry = fixture();
    await retry.listener.start(0, '127.0.0.1');
    expect(retry.listener.isRunning()).toBe(true);
  });

  it('closes a listener whose binding completes after shutdown began', async () => {
    const { listener } = fixture();
    const start = listener.start(0, '127.0.0.1');
    const rejected = expect(start).rejects.toThrow('interrupted');
    const close = listener.close();
    await Promise.all([rejected, close]);
    expect(listener.server.listening).toBe(false);
  });

  it('rejects slow headers before Express dispatch', async () => {
    const { app, listener } = fixture();
    const handler = vi.fn((_req, res: express.Response) =>
      res.end('unexpected'),
    );
    app.get('/', handler);
    await listener.start(0, '127.0.0.1');
    const response = await rawRequest(
      listener.server,
      'GET / HTTP/1.1\r\nHost: local',
    ).response;
    expect(response).toContain('408 Request Timeout');
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects a stalled request body at the server receive deadline', async () => {
    const { app, listener } = fixture();
    const handler = vi.fn((_req, res: express.Response) =>
      res.end('unexpected'),
    );
    app.use(express.json());
    app.post('/', handler);
    app.use(errorHandler);
    await listener.start(0, '127.0.0.1');
    const response = await rawRequest(
      listener.server,
      'POST / HTTP/1.1\r\nHost: local\r\nContent-Type: application/json\r\nContent-Length: 20\r\n\r\n{',
    ).response;
    expect(response).toContain('408 Request Timeout');
    expect(handler).not.toHaveBeenCalled();
  });

  it('returns one JSON 408 while retaining timed-out handler work until it settles', async () => {
    const { app, listener } = fixture(30);
    const release = deferred();
    let outcome = '';
    app.get(
      '/',
      trackHandler(async (req: express.Request, res: express.Response) => {
        await release.promise;
        outcome = 'committed';
        if (canRespond(req, res)) res.json({ unexpected: true });
      }),
    );
    app.use(errorHandler);
    await listener.start(0, '127.0.0.1');
    const response = await request(listener.server).get('/');
    expect(response.status).toBe(408);
    expect(response.body).toMatchObject({
      status: 408,
      message: 'Application response deadline exceeded.',
    });
    let closed = false;
    const closing = listener.close().then(() => {
      closed = true;
    });
    await nextTurn();
    expect(closed).toBe(false);
    release.resolve();
    await closing;
    expect(outcome).toBe('committed');
  });

  it('observes late rejection without an unhandled failure or another response', async () => {
    const { app, listener } = fixture(30);
    const release = deferred();
    app.get(
      '/',
      trackHandler(async () => {
        await release.promise;
        throw new Error('late failure');
      }),
    );
    app.use(errorHandler);
    await listener.start(0, '127.0.0.1');
    expect((await request(listener.server).get('/')).status).toBe(408);
    release.resolve();
    await listener.close();
  });

  it('terminates an incomplete response when its headers were already sent', async () => {
    const { app, listener } = fixture(30);
    const release = deferred();
    app.get(
      '/',
      trackHandler(async (_req: express.Request, res: express.Response) => {
        res.write('partial');
        await release.promise;
      }),
    );
    app.use(errorHandler);
    await listener.start(0, '127.0.0.1');
    const output = await rawRequest(
      listener.server,
      'GET / HTTP/1.1\r\nHost: local\r\nConnection: close\r\n\r\n',
    ).response;
    expect(output).toContain('200 OK');
    expect(output).toContain('partial');
    expect(output).not.toContain('Application response deadline');
    release.resolve();
  });

  it('cleans up per-request timers/listeners across a reused keep-alive socket', async () => {
    const { app, listener } = fixture(40);
    const counts: number[] = [];
    app.get('/', (req, res) => {
      counts.push(req.socket.listenerCount('timeout'));
      res.end('ok');
    });
    await listener.start(0, '127.0.0.1');
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    const sockets = new Set();
    try {
      for (let index = 0; index < 16; index++) {
        // Reuse the same socket after any stale deadline timers would have fired.
        if (index === 15)
          await new Promise((resolve) => setTimeout(resolve, 70));
        await new Promise<void>((resolve, reject) => {
          const client = get(
            { host: '127.0.0.1', port: portOf(listener.server), agent },
            (res) => {
              expect(res.statusCode).toBe(200);
              res.resume();
              res.once('end', resolve);
              res.once('error', reject);
            },
          );
          client.once('socket', (socket) => sockets.add(socket));
          client.once('error', reject);
        });
      }
      expect(sockets.size).toBe(1);
      expect(new Set(counts).size).toBe(1);
    } finally {
      agent.destroy();
    }
  });

  it('rejects admission after quiescing and forcibly bounds a stuck handler drain', async () => {
    const { app, listener } = fixture(30, 80);
    const release = deferred();
    app.get(
      '/',
      trackHandler(async () => {
        await release.promise;
      }),
    );
    app.use(errorHandler);
    await listener.start(0, '127.0.0.1');
    expect((await request(listener.server).get('/')).status).toBe(408);
    listener.quiesce();
    expect((await request(listener.server).get('/')).status).toBe(503);
    await expect(listener.close()).rejects.toThrow('drain deadline exceeded');
    expect(listener.server.listening).toBe(false);
    release.resolve();
  });

  it('drains asynchronous work after a client disconnects', async () => {
    const { app, listener } = fixture();
    const started = deferred();
    const release = deferred();
    const serverDisconnected = deferred();
    let finished = false;
    let responseSuppressed = false;
    app.get(
      '/',
      trackHandler(async (req: express.Request, res: express.Response) => {
        res.once('close', () => serverDisconnected.resolve());
        started.resolve();
        await release.promise;
        responseSuppressed = !canRespond(req, res);
        finished = true;
      }),
    );
    await listener.start(0, '127.0.0.1');
    const client = get({ host: '127.0.0.1', port: portOf(listener.server) });
    client.on('error', () => undefined);
    try {
      await started.promise;
      const disconnected = new Promise<void>((resolve) =>
        client.once('close', resolve),
      );
      client.destroy();
      // The client's close event can precede the server observing the disconnect.
      await Promise.all([disconnected, serverDisconnected.promise]);
      let closed = false;
      const closing = listener.close().then(() => {
        closed = true;
      });
      await nextTurn();
      expect(closed).toBe(false);
      expect(finished).toBe(false);
      release.resolve();
      await closing;
      // Keep assertions outside trackHandler, which intentionally handles late errors.
      expect(finished).toBe(true);
      expect(responseSuppressed).toBe(true);
    } finally {
      release.resolve();
      client.destroy();
    }
  });
});
