import { DataSource, type MigrationInterface } from 'typeorm';
import request from 'supertest';
import { createConnection } from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';
import type { EventEmitter } from 'node:events';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppDataSource, initializeDatabase } from '@/config/database.config';
import { env } from '@/config/env.config';
import { createApp } from '@/config/http-server.config';
import { LC } from '@/common/handlers/lifecycle.handler';
import { DatabaseReadiness } from '@/common/handlers/database-readiness.handler';
import { HttpListener } from '@/common/handlers/http-lifecycle.handler';
import { RequestWorkTracker } from '@/common/handlers/request-lifecycle.handler';
import { assertSafeTestDatabase } from '../helpers/database/safety';
import { MysqlProxy } from '../helpers/mysql-proxy';

assertSafeTestDatabase();
const databaseOptions = AppDataSource.options;
if (databaseOptions.type !== 'mysql')
  throw new Error('MySQL integration requires the MySQL driver.');
const proxy = new MysqlProxy(env.DB_HOST, env.DB_PORT);
let source: DataSource;
let readiness: DatabaseReadiness;
let listener: HttpListener;
let control: Awaited<ReturnType<typeof createConnection>>;
const emitter: EventEmitter = process;
const events = [
  'SIGINT',
  'SIGTERM',
  'uncaughtException',
  'unhandledRejection',
  'exit',
];
const baseline = new Map(events.map((name) => [name, emitter.listeners(name)]));

beforeAll(async () => {
  control = await createConnection({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_DATABASE,
  });
  source = new DataSource({
    ...databaseOptions,
    type: 'mysql',
    host: '127.0.0.1',
    port: await proxy.start(),
    poolSize: 1,
    connectTimeout: 300,
  });
  readiness = new DatabaseReadiness(source, {
    DB_READINESS_TIMEOUT_MS: 100,
    DB_READINESS_CACHE_MS: 20,
  });
  const work = new RequestWorkTracker();
  listener = new HttpListener(createApp(env, work), work, env);
  LC.register([
    {
      name: 'mysql',
      start: () => initializeDatabase(source),
      check: () => readiness.check(),
      stop: async () => {
        readiness.stop();
        await source.destroy();
      },
    },
    {
      name: 'http',
      start: () => listener.start(0, '127.0.0.1'),
      check: () => listener.isRunning(),
      quiesce: () => listener.quiesce(),
      stop: () => listener.close(),
    },
  ]);
  await LC.startup();
});

afterAll(async () => {
  proxy.mode = 'forward';
  await LC.shutdown();
  await proxy.close();
  await control?.end();
  for (const name of events)
    for (const handler of emitter.listeners(name))
      if (!baseline.get(name)?.includes(handler))
        emitter.removeListener(
          name,
          handler as Parameters<EventEmitter['removeListener']>[1],
        );
  process.exitCode = 0;
});

const ready = () => request(listener.server).get('/ready');
async function expectRecovery() {
  await expect
    .poll(async () => (await ready()).status, { timeout: 2_000, interval: 30 })
    .toBe(200);
  const [{ healthy }] = await source.query('SELECT 1 AS healthy');
  expect(Number(healthy)).toBe(1);
}

async function expectConnectionGone(id: number) {
  await expect
    .poll(
      async () => {
        const [rows] = await control.query<RowDataPacket[]>('SHOW PROCESSLIST');
        return rows.some((row) => Number(row.Id) === id);
      },
      { timeout: 2_000, interval: 20 },
    )
    .toBe(false);
}

describe('real MySQL readiness and recovery', () => {
  it('changes healthy → unavailable → recovered on the same running application', async () => {
    expect((await ready()).status).toBe(200);
    const [{ id }] = await source.query('SELECT CONNECTION_ID() AS id');
    proxy.disconnect();
    try {
      await expect
        .poll(async () => (await ready()).status, {
          timeout: 2_000,
          interval: 30,
        })
        .toBe(503);
      expect(source.isInitialized).toBe(true);
      expect(listener.isRunning()).toBe(true);
      const health = await request(listener.server).get('/health');
      expect(health.status).toBe(200);
      expect(health.body.alive).toBe(true);
      await expectConnectionGone(Number(id));
    } finally {
      proxy.mode = 'forward';
    }
    await expectRecovery();
  });

  it('retires a real stalled query connection and releases capacity for recovery', async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
    const [{ id }] = await source.query('SELECT CONNECTION_ID() AS id');
    proxy.mode = 'stall';
    try {
      const checks = Promise.all(Array.from({ length: 20 }, () => ready()));
      const health = await request(listener.server).get('/health');
      expect(health.status).toBe(200);
      expect((await checks).every((response) => response.status === 503)).toBe(
        true,
      );
      await expectConnectionGone(Number(id));
    } finally {
      proxy.mode = 'forward';
    }
    await expectRecovery();
  });

  it('keeps one pending pool acquisition across repeated expired readiness requests and releases its late lease', async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
    const lease = source.createQueryRunner();
    await lease.connect();
    const createRunner = vi.spyOn(source, 'createQueryRunner');
    try {
      const first = await Promise.all(
        Array.from({ length: 20 }, () => ready()),
      );
      expect(first.every((response) => response.status === 503)).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 25));
      const repeated = await Promise.all(
        Array.from({ length: 20 }, () => ready()),
      );
      expect(repeated.every((response) => response.status === 503)).toBe(true);
      expect(createRunner).toHaveBeenCalledTimes(1);
    } finally {
      createRunner.mockRestore();
      await lease.release();
    }
    await expectRecovery();
  });

  it('refuses startup with an unapplied migration, cleans its pool, and never applies it', async () => {
    const [connectionsBefore] =
      await control.query<RowDataPacket[]>('SHOW PROCESSLIST');
    let applied = false;
    class UnappliedReadiness1999999999999 implements MigrationInterface {
      async up() {
        applied = true;
      }
      async down() {}
    }
    const candidate = new DataSource({
      ...databaseOptions,
      migrations: [
        ...(AppDataSource.options.migrations as string[]),
        UnappliedReadiness1999999999999,
      ],
    });
    const [[{ count: before }]] = await control.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS count FROM migrations',
    );
    await expect(initializeDatabase(candidate)).rejects.toThrow(
      'pending migrations',
    );
    expect(candidate.isInitialized).toBe(false);
    await expect
      .poll(
        async () => {
          const [connections] =
            await control.query<RowDataPacket[]>('SHOW PROCESSLIST');
          return connections.length;
        },
        { timeout: 2_000, interval: 20 },
      )
      .toBeLessThanOrEqual(connectionsBefore.length);
    expect(applied).toBe(false);
    const [[{ count: after }]] = await control.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS count FROM migrations',
    );
    expect(after).toBe(before);
    const probe = new DatabaseReadiness(candidate, {
      DB_READINESS_TIMEOUT_MS: 100,
      DB_READINESS_CACHE_MS: 20,
    });
    expect(await probe.check()).toBe(false);
    await expectRecovery();
  });

  it('rejects absent migration history without creating the migration table', async () => {
    const candidate = new DataSource(databaseOptions);
    await control.query(
      'RENAME TABLE migrations TO readiness_saved_migrations',
    );
    try {
      await expect(initializeDatabase(candidate)).rejects.toThrow(
        'pending migrations',
      );
      expect(candidate.isInitialized).toBe(false);
      const [rows] = await control.query<RowDataPacket[]>(
        'SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
        [env.DB_DATABASE, 'migrations'],
      );
      expect(rows).toHaveLength(0);
    } finally {
      if (candidate.isInitialized) await candidate.destroy();
      await control.query(
        'RENAME TABLE readiness_saved_migrations TO migrations',
      );
    }
  });
});
