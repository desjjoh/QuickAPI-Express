import { DataSource } from 'typeorm';
import express from 'express';
import request from 'supertest';
import { errorHandler } from '@/common/middleware/error-handler.middleware';
import { createServer, type Socket } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, describe, expect, it } from 'vitest';

import { env } from '@/config/env.config';
import { AppDataSource } from '@/config/database.config';
import { databaseTransportOptions } from '@/config/database-options.config';
import { DatabaseReadiness } from '@/common/handlers/database-readiness.handler';
import { assertSafeTestDatabase } from '../helpers/database/safety';
import { portOf } from '../helpers/http';

assertSafeTestDatabase();
const databaseOptions = AppDataSource.options;
if (databaseOptions.type !== 'mysql')
  throw new Error('MySQL integration requires MySQL.');
const mysqlOptions = databaseOptions;
const sources: DataSource[] = [];
function source(overrides = {}) {
  const policy = {
    ...env,
    DB_POOL_CONNECTION_LIMIT: 1,
    DB_POOL_QUEUE_LIMIT: 1,
    DB_POOL_ACQUIRE_TIMEOUT_MS: 60,
    DB_CONNECT_TIMEOUT_MS: 200,
    ...overrides,
  };
  const result = new DataSource({
    ...mysqlOptions,
    ...databaseTransportOptions(policy),
  });

  sources.push(result);

  return result;
}
afterEach(async () => {
  for (const item of sources.splice(0))
    if (item.isInitialized) await item.destroy();
});

describe('real MySQL pool deadlines', () => {
  it('maps pool exhaustion to a stable public 503 without guessing a retry time', async () => {
    const db = source({ DB_POOL_QUEUE_LIMIT: 0 });

    await db.initialize();
    const held = db.createQueryRunner();
    const app = express();

    app.get('/', async (_req, res) => res.json(await db.query('SELECT 1')));
    app.use(errorHandler);
    await held.connect();
    try {
      const response = await request(app).get('/');

      expect(response.status).toBe(503);
      expect(response.body.message).toBe('Database temporarily unavailable.');
      expect(response.headers).not.toHaveProperty('retry-after');
    } finally {
      await held.release();
    }
  });

  it('bounds the queue, expires acquisitions, releases capacity, and skips expired SQL mutations', async () => {
    const db = source();

    await db.initialize();
    const held = db.createQueryRunner();

    await held.connect();
    try {
      const expired = db.query(
        "INSERT INTO items (id, name, price) VALUES ('poolExpired00001', 'Expired', 1)",
      );
      const rejection = expect(expired).rejects.toHaveProperty(
        'code',
        'DB_POOL_ACQUIRE_TIMEOUT',
      );

      await expect(db.query('SELECT 1')).rejects.toHaveProperty(
        'code',
        'DB_POOL_CAPACITY',
      );
      await rejection;
    } finally {
      await held.release();
    }
    expect(
      Number(
        (
          await db.query(
            "SELECT COUNT(*) AS count FROM items WHERE id='poolExpired00001'",
          )
        )[0].count,
      ),
    ).toBe(0);
    expect(Number((await db.query('SELECT 1 AS healthy'))[0].healthy)).toBe(1);
  });

  it('keeps readiness single-flight under exhaustion and recovers with the same pool', async () => {
    const db = source();

    await db.initialize();
    const held = db.createQueryRunner();
    const readiness = new DatabaseReadiness(db, {
      DB_READINESS_TIMEOUT_MS: 30,
      DB_READINESS_CACHE_MS: 10,
    });

    await held.connect();
    try {
      const checks = Array.from({ length: 30 }, () => readiness.check());

      expect(new Set(checks).size).toBe(1);
      expect(await Promise.all(checks)).toEqual(Array(30).fill(false));
    } finally {
      await held.release();
    }
    await expect
      .poll(() => readiness.check(), { timeout: 1000, interval: 20 })
      .toBe(true);
    readiness.stop();
    expect(await readiness.check()).toBe(false);
  });

  it('does not cancel a leased transaction mutation when acquisition budgets elapse', async () => {
    const db = source({ DB_POOL_ACQUIRE_TIMEOUT_MS: 40 });
    const control = source();

    await db.initialize();
    await control.initialize();
    const blocker = control.createQueryRunner();

    await blocker.startTransaction();
    await blocker.query(
      "INSERT INTO items (id, name, price) VALUES ('poolMutation0001', 'Before', 1)",
    );
    let writing: Promise<unknown> | undefined;
    let settled = false;

    try {
      writing = db.query(
        "UPDATE items SET name='After' WHERE id='poolMutation0001'",
      );
      void writing.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      await delay(120);
      expect(settled).toBe(false);
      await blocker.commitTransaction();
      await writing;
      expect(
        (
          await db.query("SELECT name FROM items WHERE id='poolMutation0001'")
        )[0].name,
      ).toBe('After');
    } finally {
      if (blocker.isTransactionActive) await blocker.rollbackTransaction();
      await writing?.catch(() => undefined);
      await blocker.release();
      await control.query("DELETE FROM items WHERE id='poolMutation0001'");
    }
  });

  it('rejects queued acquisitions when the pool closes', async () => {
    const db = source({ DB_POOL_ACQUIRE_TIMEOUT_MS: 1000 });

    await db.initialize();
    const held = db.createQueryRunner();

    await held.connect();
    const queued = expect(db.query('SELECT 1')).rejects.toHaveProperty(
      'code',
      'DB_POOL_CLOSED',
    );

    await db.destroy();
    await queued;
    await held.release();
  });

  it.each(['silent', 'partial greeting'])(
    'bounds a %s handshake and closes its socket',
    async (mode) => {
      const sockets = new Set<Socket>();
      const server = createServer((socket) => {
        sockets.add(socket);
        socket.on('error', () => undefined);
        socket.once('close', () => sockets.delete(socket));
        if (mode === 'partial greeting')
          socket.write(Buffer.from([80, 0, 0, 0, 10]));
      });

      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
      const policy = {
        ...env,
        DB_POOL_ACQUIRE_TIMEOUT_MS: 1000,
        DB_CONNECT_TIMEOUT_MS: 80,
      };
      const db = new DataSource({
        ...mysqlOptions,
        ...databaseTransportOptions(policy),
        host: '127.0.0.1',
        port: portOf(server),
      });

      sources.push(db);
      try {
        await expect(db.initialize()).rejects.toHaveProperty(
          'code',
          'DB_CONNECT_TIMEOUT',
        );
        expect(db.isInitialized).toBe(false);
        await expect.poll(() => sockets.size, { timeout: 1000 }).toBe(0);
      } finally {
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  );
});
