import express from 'express';
import request from 'supertest';
import { get } from 'node:http';
import { setImmediate as nextTurn } from 'node:timers/promises';
import type { EventEmitter } from 'node:events';
import { expect, it } from 'vitest';
import { LC } from '@/common/handlers/lifecycle.handler';
import { HttpListener } from '@/common/handlers/http-lifecycle.handler';
import {
  RequestWorkTracker,
  canRespond,
  trackHandler,
} from '@/common/handlers/request-lifecycle.handler';
import { AppDataSource } from '@/config/database.config';
import { env } from '@/config/env.config';
import { requestTimeout } from '@/common/middleware/request-timeout.middleware';
import { errorHandler } from '@/common/middleware/error-handler.middleware';
import { connectTestDatabase } from '../helpers/database/database';
import { assertSafeTestDatabase } from '../helpers/database/safety';
import { deferred, portOf } from '../helpers/http';

it('drains an actual in-flight MySQL write after its HTTP response timed out', async () => {
  assertSafeTestDatabase();
  const id = 'deadline_write01';
  const app = express();
  const work = new RequestWorkTracker();
  const listener = new HttpListener(app, work, env);
  let blocker: ReturnType<typeof AppDataSource.createQueryRunner> | undefined;
  let committed = false;
  app.use(work.admit);
  app.use(requestTimeout(30));
  app.post(
    '/',
    trackHandler(async (req: express.Request, res: express.Response) => {
      await AppDataSource.query('UPDATE items SET name = ? WHERE id = ?', [
        'Completed after deadline',
        id,
      ]);
      committed = true;
      if (canRespond(req, res)) res.status(201).end();
    }),
  );
  app.use(errorHandler);
  try {
    await connectTestDatabase();
    blocker = AppDataSource.createQueryRunner();
    await blocker.startTransaction();
    // Hold the row lock until after the response deadline; no sleep/timing race.
    await blocker.query(
      'INSERT INTO items (id, name, price) VALUES (?, ?, 1)',
      [id, 'Pending write'],
    );
    await listener.start(0, '127.0.0.1');
    expect((await request(listener.server).post('/')).status).toBe(408);
    expect(committed).toBe(false);
    const closing = listener.close();
    await blocker.commitTransaction();
    await closing;
    expect(committed).toBe(true);
    expect(AppDataSource.isInitialized).toBe(true);
    const rows = await AppDataSource.query(
      'SELECT id, name FROM items WHERE id = ?',
      [id],
    );
    expect(rows).toEqual([{ id, name: 'Completed after deadline' }]);
  } finally {
    if (blocker?.isTransactionActive) await blocker.rollbackTransaction();
    await blocker?.release();
    await listener.close();
    if (AppDataSource.isInitialized) {
      await AppDataSource.query('DELETE FROM items WHERE id = ?', [id]);
      await AppDataSource.destroy();
    }
  }
});

it('keeps real MySQL available until disconnected handler work settles', async () => {
  assertSafeTestDatabase();
  const emitter: EventEmitter = process;
  const names = [
    'SIGINT',
    'SIGTERM',
    'uncaughtException',
    'unhandledRejection',
    'exit',
  ];
  const baseline = new Map(
    names.map((event) => [event, emitter.listeners(event)]),
  );
  const release = deferred();
  const started = deferred();
  const serverDisconnected = deferred();
  const calls: string[] = [];
  const app = express();
  const work = new RequestWorkTracker();
  app.use(work.admit);
  let databaseWorked = false;
  let responseSuppressed = false;
  app.get(
    '/',
    trackHandler(async (req: express.Request, res: express.Response) => {
      res.once('close', () => serverDisconnected.resolve());
      started.resolve();
      await release.promise;
      const result = await AppDataSource.query('SELECT 1 AS healthy');
      databaseWorked = Number(result[0].healthy) === 1;
      responseSuppressed = !canRespond(req, res);
      calls.push('query-finished');
    }),
  );
  const listener = new HttpListener(app, work, env);
  LC.register([
    {
      name: 'mysql',
      start: connectTestDatabase,
      stop: async () => {
        calls.push('mysql-stop');
        await AppDataSource.destroy();
      },
    },
    {
      name: 'http',
      start: () => listener.start(0, '127.0.0.1'),
      quiesce: () => listener.quiesce(),
      stop: () => listener.close(),
    },
  ]);
  try {
    await LC.startup();
    const client = get({ host: '127.0.0.1', port: portOf(listener.server) });
    client.on('error', () => undefined);
    await started.promise;
    const disconnected = new Promise<void>((resolve) =>
      client.once('close', resolve),
    );
    client.destroy();
    await Promise.all([disconnected, serverDisconnected.promise]);
    const shutdown = LC.shutdown();
    expect(LC.isReady()).toBe(false);
    await nextTurn();
    expect(AppDataSource.isInitialized).toBe(true);
    expect(calls).toEqual([]);
    release.resolve();
    await shutdown;
    expect(databaseWorked).toBe(true);
    expect(responseSuppressed).toBe(true);
    expect(calls).toEqual(['query-finished', 'mysql-stop']);
  } finally {
    release.resolve();
    await LC.shutdown();
    for (const event of names)
      for (const listener of emitter.listeners(event)) {
        if (!baseline.get(event)?.includes(listener))
          emitter.removeListener(
            event,
            listener as Parameters<EventEmitter['removeListener']>[1],
          );
      }
    process.exitCode = 0;
  }
});
