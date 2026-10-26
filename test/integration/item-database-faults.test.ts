import request from 'supertest';
import express from 'express';
import { request as httpRequest } from 'node:http';
import { deferred, portOf } from '../helpers/http';
import { createConnection } from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';
import type { EventEmitter } from 'node:events';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { AppDataSource, initializeDatabase } from '@/config/database.config';
import { env } from '@/config/env.config';
import { createApp } from '@/config/http-server.config';
import { DatabaseReadiness } from '@/common/handlers/database-readiness.handler';
import { HttpListener } from '@/common/handlers/http-lifecycle.handler';
import { LC } from '@/common/handlers/lifecycle.handler';
import { RequestWorkTracker } from '@/common/handlers/request-lifecycle.handler';
import { assertSafeTestDatabase } from '../helpers/database/safety';
import { MysqlQueryProxy } from '../helpers/mysql-query-proxy';

assertSafeTestDatabase();
const originalOptions = { ...AppDataSource.options };
const originalDriverOptions = { ...AppDataSource.driver.options };
const proxy = new MysqlQueryProxy(env.DB_HOST, env.DB_PORT);
const work = new RequestWorkTracker();
const readiness = new DatabaseReadiness(AppDataSource, {
  DB_READINESS_TIMEOUT_MS: 100,
  DB_READINESS_CACHE_MS: 0,
});
const listener = new HttpListener(
  createApp({ ...env, REQUEST_TIMEOUT_MS: 2_000 }, work),
  work,
  env,
);
const emitter: EventEmitter = process;
const events = [
  'SIGINT',
  'SIGTERM',
  'uncaughtException',
  'unhandledRejection',
  'exit',
];
const baseline = new Map(events.map((name) => [name, emitter.listeners(name)]));
const id = 'faultfixture0001';
let control: Awaited<ReturnType<typeof createConnection>>;
let controlId: number;

beforeAll(async () => {
  control = await createConnection({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_DATABASE,
  });
  const [[row]] = await control.query<RowDataPacket[]>(
    'SELECT CONNECTION_ID() AS id',
  );
  controlId = Number(row.id);
  const transport = {
    host: '127.0.0.1',
    port: await proxy.start(),
    poolSize: 1,
    connectTimeout: 300,
  };
  // TypeORM snapshots driver options at construction. Retarget both public
  // option objects before initialization so the real global repository uses the proxy.
  AppDataSource.setOptions(transport);
  Object.assign(AppDataSource.driver.options, transport);
  LC.register([
    {
      name: 'mysql',
      start: () => initializeDatabase(AppDataSource),
      check: () => readiness.check(),
      stop: async () => {
        readiness.stop();
        if (AppDataSource.isInitialized) await AppDataSource.destroy();
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

beforeEach(async () => {
  proxy.recover();
  await control.query('DELETE FROM items');
  await control.query(
    'INSERT INTO items (id, name, price, description) VALUES (?, ?, 3.25, ?)',
    [id, 'Original item', 'Preserve this description'],
  );
  proxy.queries.length = 0;
});

afterEach(async () => {
  proxy.disconnect();
  proxy.recover();
  await work.drain();
  await control.query('DELETE FROM items');
});

afterAll(async () => {
  try {
    await LC.shutdown();
  } finally {
    await proxy.close();
    await control?.end();
    AppDataSource.setOptions(originalOptions);
    Object.assign(AppDataSource.driver.options, originalDriverOptions);
    for (const name of events)
      for (const handler of emitter.listeners(name))
        if (!baseline.get(name)?.includes(handler))
          emitter.removeListener(
            name,
            handler as Parameters<EventEmitter['removeListener']>[1],
          );
    process.exitCode = 0;
  }
});

type Method = 'get' | 'list' | 'post' | 'patch' | 'put' | 'delete';
type Mutation = 'post' | 'patch' | 'put' | 'delete';
function begin(method: Method, target = listener.server) {
  const pending =
    method === 'list'
      ? request(target).get('/api/v1/items')
      : request(target)[method === 'delete' ? 'post' : method](
          method === 'post'
            ? '/api/v1/items'
            : `/api/v1/items/${id}${method === 'delete' ? '/delete' : ''}`,
        );
  if (method === 'delete') pending.send({ expected_version: 1 });
  else if (['post', 'patch', 'put'].includes(method))
    pending.send({
      name: 'Mutation committed',
      price: 7.5,
      expected_version: 1,
    });
  const result = pending.then((response) => response);
  void result.catch(() => undefined);
  return result;
}
async function observed(
  gate: { observed: Promise<string> },
  response: Promise<{ status: number }>,
) {
  await Promise.race([
    gate.observed,
    response.then((result) => {
      throw new Error(
        `HTTP ${result.status} completed without interception; SQL: ${JSON.stringify(proxy.queries)}`,
      );
    }),
  ]);
}
async function rows() {
  const [result] = await control.query<RowDataPacket[]>(
    'SELECT * FROM items ORDER BY id',
  );
  return result;
}
async function connectionGone(connectionId: number) {
  await expect
    .poll(
      async () => {
        const [connections] =
          await control.query<RowDataPacket[]>('SHOW PROCESSLIST');
        return connections.some((row) => Number(row.Id) === connectionId);
      },
      { timeout: 2_000, interval: 20 },
    )
    .toBe(false);
}
async function connectionId() {
  const [row] = await AppDataSource.query('SELECT CONNECTION_ID() AS id');
  return Number(row.id);
}
async function recovered() {
  await expect
    .poll(async () => (await request(listener.server).get('/ready')).status, {
      timeout: 2_000,
      interval: 20,
    })
    .toBe(200);
  // A single-slot pool must remain usable for successive queued operations.
  const checks = await Promise.all(
    Array.from({ length: 8 }, () => AppDataSource.query('SELECT 1 AS healthy')),
  );
  expect(checks.map((rows) => Number(rows[0].healthy))).toEqual(
    Array(8).fill(1),
  );
  const [connections] =
    await control.query<RowDataPacket[]>('SHOW PROCESSLIST');
  expect(
    connections.filter(
      (row) => row.db === env.DB_DATABASE && Number(row.Id) !== controlId,
    ),
  ).toHaveLength(1);
  expect(AppDataSource.isInitialized).toBe(true);
}
function expectUnavailable(response: Awaited<ReturnType<typeof begin>>) {
  // Established/handshake transport failures currently use the generic 500 contract.
  // Pool admission failures have separate 503 coverage; do not change the API here.
  expect(response.status).toBe(500);
  expect(response.body).toEqual({
    status: 500,
    message: 'Internal Server Error',
    timestamp: expect.any(Number),
  });
  expect(response.headers).not.toHaveProperty('retry-after');
}

describe('real item persistence across MySQL transport faults', () => {
  it.each<Method>(['get', 'list', 'post', 'patch', 'put', 'delete'])(
    'preserves data while %s fails offline and succeeds after recovery',
    async (method) => {
      const before = await rows();
      const lost = await connectionId();
      proxy.disconnect();
      expectUnavailable(await begin(method));
      expect((await request(listener.server).get('/ready')).status).toBe(503);
      expect((await request(listener.server).get('/health')).status).toBe(200);
      await connectionGone(lost);
      expect(await rows()).toEqual(before);
      proxy.recover();
      await recovered();
      expect((await begin(method)).status).toBe(method === 'post' ? 201 : 200);
      const persisted = await rows();
      if (method === 'post') expect(persisted).toHaveLength(2);
      else if (method === 'delete') expect(persisted).toHaveLength(0);
      else if (method === 'patch' || method === 'put')
        expect(persisted[0].name).toBe('Mutation committed');
      else expect(persisted).toEqual(before);
    },
  );

  it.each<Mutation>(['post', 'patch', 'put', 'delete'])(
    'leaves data unchanged when %s loses its connection before the mutation reaches MySQL',
    async (method) => {
      const before = await rows();
      const lost = await connectionId();
      const query =
        method === 'post'
          ? /^INSERT INTO/i
          : method === 'delete'
            ? /^DELETE FROM/i
            : /^UPDATE /i;
      const gate = proxy.intercept(query, 'before-query');
      const response = begin(method);
      try {
        await observed(gate, response);
        gate.disconnect();
        expectUnavailable(await response);
        await connectionGone(lost);
        expect(await rows()).toEqual(before);
        await recovered();
      } finally {
        gate.disconnect();
      }
    },
  );

  it.each<Mutation>(['post', 'patch', 'put', 'delete'])(
    'observes committed %s data even when the COMMIT acknowledgement is lost',
    async (method) => {
      const lost = await connectionId();
      const gate = proxy.intercept(/^COMMIT$/i, 'before-result');
      const response = begin(method);
      try {
        await observed(gate, response);
        await expect
          .poll(
            async () => {
              const persisted = await rows();
              return method === 'delete'
                ? persisted.length === 0
                : persisted.some((row) => row.name === 'Mutation committed');
            },
            { timeout: 1_000, interval: 10 },
          )
          .toBe(true);
        const committed = await rows();
        gate.disconnect();
        expectUnavailable(await response);
        await connectionGone(lost);
        expect(await rows()).toEqual(committed);
        expect(
          proxy.queries.filter((query) =>
            /^(INSERT INTO|UPDATE |DELETE FROM)/i.test(query),
          ),
        ).toHaveLength(1);
        await recovered();
        expect(
          (await request(listener.server).get('/api/v1/items')).body.total,
        ).toBe(method === 'post' ? 2 : method === 'delete' ? 0 : 1);
      } finally {
        gate.disconnect();
      }
    },
  );

  it.each(['patch', 'put', 'delete'] as const)(
    'rolls back %s after a real lookup result outlives the HTTP deadline',
    async (method) => {
      const before = await rows();
      // Establish the real lease before timing a lookup, not a fresh handshake.
      await connectionId();
      const delayedWork = new RequestWorkTracker();
      const delayedApp = createApp(
        { ...env, REQUEST_TIMEOUT_MS: 200 },
        delayedWork,
      );
      const gate = proxy.intercept(/^SELECT .*FROM `items`/i, 'before-result');
      const response = request(delayedApp)[
        method === 'delete' ? 'post' : method
      ](`/api/v1/items/${id}${method === 'delete' ? '/delete' : ''}`);
      response.send(
        method === 'delete'
          ? { expected_version: 1 }
          : { name: 'Too late', price: 9, expected_version: 1 },
      );
      const pending = response.then((result) => result);
      void pending.catch(() => undefined);
      try {
        await observed(gate, pending);
        expect((await pending).status).toBe(408);
        gate.resume();
        await delayedWork.drain();
        expect(await rows()).toEqual(before);
        expect(
          proxy.queries.some((query) => /^(UPDATE |DELETE FROM)/i.test(query)),
        ).toBe(true);
        expect(proxy.queries).toContain('ROLLBACK');
        expect(proxy.queries).not.toContain('COMMIT');
        await recovered();
      } finally {
        gate.resume();
        await delayedWork.drain();
      }
    },
  );

  it.each(
    (['post', 'patch', 'put', 'delete'] as const).flatMap((method) =>
      (['timeout', 'disconnect'] as const).map((failure) => ({
        method,
        failure,
      })),
    ),
  )(
    'rolls back $method on $failure while its mutation result is withheld',
    async ({ method, failure }) => {
      const before = await rows();
      const delayedWork = new RequestWorkTracker();
      const closed = deferred();
      const outer = express();
      outer.use((_req, res, next) => {
        res.once('close', () => closed.resolve());
        next();
      });
      outer.use(
        createApp(
          { ...env, REQUEST_TIMEOUT_MS: failure === 'timeout' ? 200 : 2000 },
          delayedWork,
        ),
      );
      const server = outer.listen(0, '127.0.0.1');
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const gate = proxy.intercept(
        method === 'post'
          ? /^INSERT INTO/i
          : method === 'delete'
            ? /^DELETE FROM/i
            : /^UPDATE /i,
        'before-result',
      );
      const response = deferred<number>();
      const payload = JSON.stringify(
        method === 'delete'
          ? { expected_version: 1 }
          : { name: 'Must roll back', price: 8, expected_version: 1 },
      );
      const client = httpRequest(
        {
          host: '127.0.0.1',
          port: portOf(server),
          method: method === 'delete' ? 'POST' : method.toUpperCase(),
          path:
            method === 'post'
              ? '/api/v1/items'
              : `/api/v1/items/${id}${method === 'delete' ? '/delete' : ''}`,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': String(Buffer.byteLength(payload)),
          },
        },
        (res) => {
          res.resume();
          response.resolve(res.statusCode!);
        },
      );
      client.on('error', () => undefined);
      client.end(payload);
      try {
        await observed(
          gate,
          response.promise.then((status) => ({ status })),
        );
        if (failure === 'timeout') expect(await response.promise).toBe(408);
        else client.destroy();
        await closed.promise;
        // SQL is still outstanding: never release or roll back its connection early.
        expect(proxy.queries).not.toContain('ROLLBACK');
        expect(proxy.queries).not.toContain('COMMIT');
        gate.resume();
        await delayedWork.drain();
        expect(proxy.queries).toContain('ROLLBACK');
        expect(proxy.queries).not.toContain('COMMIT');
        expect(await rows()).toEqual(before);
        await recovered();
      } finally {
        client.destroy();
        gate.resume();
        await delayedWork.drain();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  );

  it('recovers a single-slot pool through repeated failed writes without retaining connections', async () => {
    const before = await rows();
    for (let attempt = 0; attempt < 5; attempt++) {
      const lost = await connectionId();
      const gate = proxy.intercept(/^INSERT INTO/i, 'before-query');
      const response = begin('post');
      try {
        await observed(gate, response);
        gate.disconnect();
        expectUnavailable(await response);
        await connectionGone(lost);
        await recovered();
      } finally {
        gate.disconnect();
      }
    }
    expect(await rows()).toEqual(before);
    expect((await begin('post')).status).toBe(201);
    expect(await rows()).toHaveLength(2);
  });
});
