import express from 'express';
import request from 'supertest';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { createApp } from '@/config/http-server.config';
import { env } from '@/config/env.config';
import { AppDataSource } from '@/config/database.config';
import { itemRepository } from '@/database/repositories/item.repo';
import { itemService } from '@/api/v1/items/services/items.service';
import { toItemDTO } from '@/api/v1/items/models/item.model';
import { CreateItemSchema } from '@/api/v1/items/models/item-create.model';
import { jsonHandler } from '@/common/handlers/http-response.handler';
import { RequestWorkTracker } from '@/common/handlers/request-lifecycle.handler';
import { validateRequest } from '@/common/middleware/validate-request.middleware';
import { requestTimeout } from '@/common/middleware/request-timeout.middleware';
import { errorHandler } from '@/common/middleware/error-handler.middleware';
import {
  currentRequestContext,
  type RequestContext,
} from '@/common/helpers/request-context.helper';
import {
  connectTestDatabase,
  disconnectTestDatabase,
  resetTestDatabase,
} from '../helpers/database/database';
import { deferred, rawRequest } from '../helpers/http';

const path = '/api/v1/items';
const input = { name: 'Original', price: '12.50' };
const key = 'http-retry-key';
const policy = {
  ...env,
  RATE_LIMIT_MAX: 1000,
  RATE_LIMIT_MAX_CLIENTS: 1000,
  CORS_ORIGINS: ['https://client.example'],
};
beforeAll(connectTestDatabase);
beforeEach(resetTestDatabase);
afterEach(() => vi.restoreAllMocks());
afterAll(disconnectTestDatabase);
async function counts() {
  const [items] = await AppDataSource.query(
    'SELECT COUNT(*) AS count FROM items',
  );
  const [replays] = await AppDataSource.query(
    'SELECT COUNT(*) AS count FROM request_idempotency',
  );
  return { items: Number(items.count), replays: Number(replays.count) };
}
function adapter(map = toItemDTO, timeout = 1000, status = 201) {
  const app = express();
  const work = new RequestWorkTracker();
  app.use(work.admit, requestTimeout(timeout), express.json());
  app.post(
    '/',
    validateRequest({ body: CreateItemSchema }),
    jsonHandler(itemService.create, map, {
      status,
      transaction: true,
      idempotency: {
        scope: 'public',
        operation: 'test.create',
        route: 'POST /test',
      },
    }),
  );
  app.use(errorHandler);
  return { app, work };
}

describe('optional item creation idempotency through HTTP', () => {
  it.each([204, 205])(
    'prepares and replays a bodyless %s without invoking the mapper twice',
    async (status) => {
      const map = vi.fn(toItemDTO);
      const { app } = adapter(map, 1000, status);
      const first = await request(app)
        .post('/')
        .set('Idempotency-Key', key)
        .send(input)
        .expect(status);
      const replay = await request(app)
        .post('/')
        .set('Idempotency-Key', key)
        .send(input)
        .expect(status);
      expect(first.text).toBe('');
      expect(replay.text).toBe('');
      expect(map).toHaveBeenCalledTimes(1);
      expect(await counts()).toEqual({ items: 1, replays: 1 });
    },
  );

  it('rolls back disconnected keyed HTTP work after it settles and permits a retry', async () => {
    const { app, work } = adapter();
    const started = deferred();
    const finish = deferred();
    const create = itemRepository.create.bind(itemRepository);
    let context: RequestContext | undefined;
    vi.spyOn(itemRepository, 'create').mockImplementationOnce(
      async (...args) => {
        const item = await create(...args);
        context = currentRequestContext();
        started.resolve();
        await finish.promise;
        return item;
      },
    );
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const json = JSON.stringify(input);
    const client = rawRequest(
      server,
      `POST / HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(json)}\r\nIdempotency-Key: ${key}\r\nConnection: close\r\n\r\n${json}`,
    );
    try {
      await started.promise;
      client.socket.destroy();
      await client.response;
      await expect.poll(() => context?.signal.aborted).toBe(true);
      expect(await counts()).toEqual({ items: 0, replays: 0 });
    } finally {
      client.socket.destroy();
      finish.resolve();
      await work.drain();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
    expect(await counts()).toEqual({ items: 0, replays: 0 });
    await request(app)
      .post('/')
      .set('Idempotency-Key', key)
      .send(input)
      .expect(201);
  });
  it('replays exact JSON for normalized input with fresh correlation IDs and no service/DTO execution', async () => {
    const app = createApp(policy);
    const create = vi.spyOn(itemRepository, 'create');
    const original = await request(app)
      .post(path)
      .set('Idempotency-Key', key)
      .send(input);
    const replay = await request(app)
      .post(path)
      .set('Idempotency-Key', key)
      .set('X-Request-Id', 'transport-noise')
      .send({ price: 12.5, name: 'Original', ignored: true });
    expect(original.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.text).toBe(original.text);
    expect(replay.headers['content-type']).toMatch(/^application\/json/);
    expect(replay.headers['x-request-id']).not.toBe(
      original.headers['x-request-id'],
    );
    expect(replay.headers['set-cookie']).toBeUndefined();
    expect(create).toHaveBeenCalledTimes(1);
    const [before] = await AppDataSource.query(
      'SELECT * FROM request_idempotency',
    );
    expect(before.caller_scope).toBe('public');
    expect(before.operation).toBe('items.create');
    await request(app)
      .patch(`${path}/${original.body.id}`)
      .send({ name: 'Updated', expected_version: 1 })
      .expect(200);
    await request(app)
      .post(`${path}/${original.body.id}/delete`)
      .send({ expected_version: 2 })
      .expect(200);
    await request(app)
      .post(path)
      .set('Idempotency-Key', key)
      .send(input)
      .expect(201, original.body);
    expect(await counts()).toEqual({ items: 0, replays: 1 });
    expect(
      (await AppDataSource.query('SELECT * FROM request_idempotency'))[0],
    ).toEqual(before);
  });

  it('preserves unkeyed creation and ignores keys on read endpoints', async () => {
    const app = createApp(policy);
    const first = await request(app).post(path).send(input).expect(201);
    const second = await request(app).post(path).send(input).expect(201);
    expect(first.body.id).not.toBe(second.body.id);
    await request(app)
      .get(`${path}/${first.body.id}`)
      .set('Idempotency-Key', 'invalid key, ignored')
      .expect(200);
    expect(await counts()).toEqual({ items: 2, replays: 0 });
  });

  it.each(['', 'a b', 'a,b', 'a'.repeat(129), 'é'])(
    'rejects malformed key %s without database work',
    async (value) => {
      const app = createApp(policy);
      const transaction = vi.spyOn(AppDataSource, 'createQueryRunner');
      await request(app)
        .post(path)
        .set('Idempotency-Key', value)
        .send(input)
        .expect(400);
      expect(transaction).not.toHaveBeenCalled();
      expect(await counts()).toEqual({ items: 0, replays: 0 });
    },
  );

  it('rejects duplicate raw key headers, including identical values', async () => {
    const app = createApp(policy);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    try {
      for (const other of [key, 'different']) {
        const json = JSON.stringify(input);
        const result = rawRequest(
          server,
          `POST ${path} HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(json)}\r\nIdempotency-Key: ${key}\r\nidempotency-key: ${other}\r\nConnection: close\r\n\r\n${json}`,
        );
        expect(await result.response).toContain('400 Bad Request');
      }
      expect(await counts()).toEqual({ items: 0, replays: 0 });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('rejects invalid input before claims and distinguishes semantic changes and key case', async () => {
    const app = createApp(policy);
    await request(app)
      .post(path)
      .set('Idempotency-Key', key)
      .send({ name: '', price: 1 })
      .expect(422);
    expect(await counts()).toEqual({ items: 0, replays: 0 });
    await request(app)
      .post(path)
      .set('Idempotency-Key', key)
      .send(input)
      .expect(201);
    await request(app)
      .post(path)
      .set('Idempotency-Key', key)
      .send({ ...input, description: null })
      .expect(409);
    await request(app)
      .post(path)
      .set('Idempotency-Key', key.toUpperCase())
      .send(input)
      .expect(201);
    expect(await counts()).toEqual({ items: 2, replays: 2 });
  });

  it('returns busy-key 409 while work is blocked and replays after commit', async () => {
    const app = createApp(policy);
    const started = deferred();
    const finish = deferred();
    const create = itemRepository.create.bind(itemRepository);
    vi.spyOn(itemRepository, 'create').mockImplementationOnce(
      async (...args) => {
        const item = await create(...args);
        started.resolve();
        await finish.promise;
        return item;
      },
    );
    const pending = request(app)
      .post(path)
      .set('Idempotency-Key', key)
      .send(input)
      .then((response) => response);
    try {
      await started.promise;
      await request(app)
        .post(path)
        .set('Idempotency-Key', key)
        .send(input)
        .expect(409);
      await request(app)
        .post(path)
        .set('Idempotency-Key', key)
        .send({ ...input, name: 'Different' })
        .expect(409);
      expect(await counts()).toEqual({ items: 0, replays: 0 });
    } finally {
      finish.resolve();
    }
    const original = await pending;
    expect(original.status).toBe(201);
    await request(app)
      .post(path)
      .set('Idempotency-Key', key)
      .send(input)
      .expect(201, original.body);
  });

  it('allows keyed browser preflight and rejects forbidden origins/headers without writes', async () => {
    const app = createApp(policy);
    const preflight = await request(app)
      .options(path)
      .set('Origin', 'https://client.example')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,Idempotency-Key')
      .expect(204);
    expect(preflight.headers['access-control-allow-headers']).toContain(
      'idempotency-key',
    );
    expect(preflight.headers.vary).toContain('Access-Control-Request-Headers');
    await request(app)
      .post(path)
      .set('Origin', 'https://client.example')
      .set('Idempotency-Key', key)
      .send(input)
      .expect(201);
    await request(app)
      .post(path)
      .set('Origin', 'https://evil.example')
      .set('Idempotency-Key', 'another')
      .send(input)
      .expect(403);
    await request(app)
      .options(path)
      .set('Origin', 'https://client.example')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'x-not-allowed')
      .expect(403);
    expect(await counts()).toEqual({ items: 1, replays: 1 });
  });

  it('keeps server-side keyed enforcement even when a custom CORS allowlist omits the header', async () => {
    const app = createApp({
      ...policy,
      CORS_ALLOWED_HEADERS: ['content-type'],
    });
    await request(app)
      .post(path)
      .set('Idempotency-Key', key)
      .send(input)
      .expect(201);
    await request(app)
      .post(path)
      .set('Idempotency-Key', key)
      .send(input)
      .expect(201);
    await request(app)
      .options(path)
      .set('Origin', 'https://client.example')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'idempotency-key')
      .expect(403);
    expect(await counts()).toEqual({ items: 1, replays: 1 });
  });

  it('retains rate limiting for matching retries', async () => {
    const app = createApp({ ...policy, RATE_LIMIT_MAX: 1 });
    await request(app)
      .post(path)
      .set('Idempotency-Key', key)
      .send(input)
      .expect(201);
    await request(app)
      .post(path)
      .set('Idempotency-Key', key)
      .send(input)
      .expect(429);
    expect(await counts()).toEqual({ items: 1, replays: 1 });
  });

  it.each(['DTO', 'JSON', 'oversized'] as const)(
    'rolls back keyed HTTP creation on %s preparation failure',
    async (fault) => {
      const { app } = adapter((item) => {
        if (fault === 'DTO') return toItemDTO({ ...item, name: '' });
        const dto = toItemDTO(item);
        Object.defineProperty(dto, 'toJSON', {
          value: () =>
            fault === 'JSON' ? { value: BigInt(1) } : 'x'.repeat(65536),
        });
        return dto;
      });
      await request(app)
        .post('/')
        .set('Idempotency-Key', key)
        .send(input)
        .expect(500);
      expect(await counts()).toEqual({ items: 0, replays: 0 });
      const recovered = adapter();
      await request(recovered.app)
        .post('/')
        .set('Idempotency-Key', key)
        .send(input)
        .expect(201);
    },
  );

  it('times out keyed work without committing and allows retry after drain', async () => {
    const { app, work } = adapter(toItemDTO, 200);
    const started = deferred();
    const finish = deferred();
    const create = itemRepository.create.bind(itemRepository);
    vi.spyOn(itemRepository, 'create').mockImplementationOnce(
      async (...args) => {
        const item = await create(...args);
        started.resolve();
        await finish.promise;
        return item;
      },
    );
    const pending = request(app)
      .post('/')
      .set('Idempotency-Key', key)
      .send(input)
      .then((response) => response);
    try {
      await started.promise;
      const response = await pending;
      expect(response.status).toBe(408);
      expect(await counts()).toEqual({ items: 0, replays: 0 });
    } finally {
      finish.resolve();
      await work.drain();
    }
    expect(await counts()).toEqual({ items: 0, replays: 0 });
    await request(app)
      .post('/')
      .set('Idempotency-Key', key)
      .send(input)
      .expect(201);
  });
});
