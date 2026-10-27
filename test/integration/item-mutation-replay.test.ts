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
import { idempotencyNamespace } from '@/config/idempotency.config';
import { itemRepository } from '@/database/repositories/item.repo';
import { toItemDTO } from '@/api/v1/items/models/item.model';
import { IdempotencyRepository } from '@/database/repositories/idempotency.repo';
import {
  idempotencyScopeHash,
  requestFingerprint,
} from '@/common/helpers/idempotency.helper';
import {
  connectTestDatabase,
  disconnectTestDatabase,
  resetTestDatabase,
} from '../helpers/database/database';
import { deferred } from '../helpers/http';

const cases = [
  {
    method: 'patch',
    operation: 'items.update',
    template: 'PATCH /api/v1/items/:id',
    suffix: '',
  },
  {
    method: 'put',
    operation: 'items.replace',
    template: 'PUT /api/v1/items/:id',
    suffix: '',
  },
  {
    method: 'post',
    operation: 'items.delete',
    template: 'POST /api/v1/items/:id/delete',
    suffix: '/delete',
  },
] as const;
const path = '/api/v1/items';
const key = 'mutation-key';
const policy = { ...env, RATE_LIMIT_MAX: 1000, RATE_LIMIT_MAX_CLIENTS: 1000 };
function body(method: string, version = 1) {
  return method === 'post'
    ? { expected_version: version }
    : { name: 'Changed', price: 2, expected_version: version };
}
async function rows() {
  return AppDataSource.query('SELECT * FROM items ORDER BY id');
}
async function replays() {
  return AppDataSource.query(
    'SELECT * FROM request_idempotency ORDER BY scope_hash',
  );
}
beforeAll(connectTestDatabase);
beforeEach(resetTestDatabase);
afterEach(() => vi.restoreAllMocks());
afterAll(disconnectTestDatabase);

describe('versioned item mutation replay', () => {
  it.each(cases)(
    'replays $operation with its original version/body after later changes, without more writes',
    async ({ method, operation, template, suffix }) => {
      const app = createApp(policy);
      const item = await itemRepository.create({ name: 'Original', price: 1 });
      const url = `${path}/${item.id}${suffix}`;
      const payload = body(method);
      const first = await request(app)
        [method](url)
        .set('Idempotency-Key', key)
        .send(payload)
        .expect(200);
      expect(first.body.version).toBe(method === 'post' ? 1 : 2);
      const [record] = await replays();
      expect(record).toMatchObject({
        caller_scope: 'public',
        operation,
        route: template,
        state: 'completed',
        response_status: 200,
      });
      expect(record.scope_hash).toBe(
        idempotencyScopeHash(
          {
            namespace: idempotencyNamespace,
            callerScope: 'public',
            operation,
            route: template,
          },
          key,
        ),
      );
      if (method !== 'post')
        await request(app)
          .patch(`${path}/${item.id}`)
          .send({ name: 'Later', expected_version: 2 })
          .expect(200);
      const before = await rows();
      const history = await replays();
      const replay = await request(app)
        [method](`${url}?ignored=transport-noise`)
        .set('Idempotency-Key', key)
        .send(payload)
        .expect(200);
      expect(replay.text).toBe(first.text);
      expect(replay.headers['x-request-id']).not.toBe(
        first.headers['x-request-id'],
      );
      expect(await rows()).toEqual(before);
      expect(await replays()).toEqual(history);
      // A new/no-key attempt still enforces current state, rather than replaying old success.
      await request(app)
        [method](url)
        .send(payload)
        .expect(method === 'post' ? 404 : 409);
      await request(app)
        [method](url)
        .set('Idempotency-Key', 'new-attempt')
        .send(payload)
        .expect(method === 'post' ? 404 : 409);
      expect(await replays()).toEqual(history);
    },
  );

  it.each(cases)(
    'rejects changed parameter/version/payload under the same $operation key',
    async ({ method, suffix }) => {
      const app = createApp(policy);
      const first = await itemRepository.create({ name: 'First', price: 1 });
      const second = await itemRepository.create({ name: 'Second', price: 1 });
      const url = `${path}/${first.id}${suffix}`;
      await request(app)
        [method](url)
        .set('Idempotency-Key', key)
        .send(body(method))
        .expect(200);
      const before = await rows();
      const history = await replays();
      await request(app)
        [method](`${path}/${second.id}${suffix}`)
        .set('Idempotency-Key', key)
        .send(body(method))
        .expect(409);
      await request(app)
        [method](url)
        .set('Idempotency-Key', key)
        .send(body(method, 2))
        .expect(409);
      if (method !== 'post')
        await request(app)
          [method](url)
          .set('Idempotency-Key', key)
          .send({ ...body(method), name: 'Different' })
          .expect(409);
      await request(app)
        [method](url)
        .set('Idempotency-Key', key)
        .send({})
        .expect(422);
      expect(await rows()).toEqual(before);
      expect(await replays()).toEqual(history);
    },
  );

  it.each(cases)(
    'rejects invalid keys for $operation before a transaction',
    async ({ method, suffix }) => {
      const app = createApp(policy);
      const item = await itemRepository.create({ name: 'Original', price: 1 });
      const queryRunner = vi.spyOn(AppDataSource, 'createQueryRunner');
      await request(app)
        [method](`${path}/${item.id}${suffix}`)
        .set('Idempotency-Key', 'invalid key')
        .send(body(method))
        .expect(400);
      expect(queryRunner).not.toHaveBeenCalled();
      expect(await replays()).toEqual([]);
    },
  );

  it.each(cases)(
    'fences overlapping $operation calls and replays after commit',
    async ({ method, suffix }) => {
      const app = createApp(policy);
      const item = await itemRepository.create({ name: 'Original', price: 1 });
      const started = deferred();
      const finish = deferred();
      const lookup = itemRepository.get_by_id_for_update.bind(itemRepository);
      vi.spyOn(itemRepository, 'get_by_id_for_update').mockImplementationOnce(
        async (...args) => {
          const found = await lookup(...args);
          started.resolve();
          await finish.promise;
          return found;
        },
      );
      const url = `${path}/${item.id}${suffix}`;
      const pending = request(app)
        [method](url)
        .set('Idempotency-Key', key)
        .send(body(method))
        .then((response) => response);
      try {
        await started.promise;
        await request(app)
          [method](url)
          .set('Idempotency-Key', key)
          .send(body(method))
          .expect(409);
        await request(app)
          [method](url)
          .set('Idempotency-Key', key)
          .send(body(method, 2))
          .expect(409);
        expect(await replays()).toEqual([]);
      } finally {
        finish.resolve();
      }
      const first = await pending;
      expect(first.status).toBe(200);
      await request(app)
        [method](url)
        .set('Idempotency-Key', key)
        .send(body(method))
        .expect(200, first.body);
    },
  );

  it.each(cases)(
    'rolls back $operation and its claim when DTO validation fails, then retries successfully',
    async ({ method, suffix }) => {
      const app = createApp(policy);
      const item = await itemRepository.create({ name: 'Original', price: 1 });
      const before = await rows();
      if (method === 'post') {
        const remove = itemRepository.remove.bind(itemRepository);
        vi.spyOn(itemRepository, 'remove').mockImplementationOnce(
          async (...args) => ({ ...(await remove(...args)), name: '' }),
        );
      } else {
        const update = itemRepository.update.bind(itemRepository);
        vi.spyOn(itemRepository, 'update').mockImplementationOnce(
          async (...args) => ({ ...(await update(...args)), name: '' }),
        );
      }
      const url = `${path}/${item.id}${suffix}`;
      await request(app)
        [method](url)
        .set('Idempotency-Key', key)
        .send(body(method))
        .expect(500);
      expect(await rows()).toEqual(before);
      expect(await replays()).toEqual([]);
      await request(app)
        [method](url)
        .set('Idempotency-Key', key)
        .send(body(method))
        .expect(200);
      expect(await replays()).toHaveLength(1);
    },
  );

  it('separates create, PATCH, PUT and deletion even with the same public key', async () => {
    const app = createApp(policy);
    const created = await request(app)
      .post(path)
      .set('Idempotency-Key', key)
      .send({ name: 'Original', price: 1 })
      .expect(201);
    for (const [index, { method, suffix }] of cases.entries())
      await request(app)
        [method](`${path}/${created.body.id}${suffix}`)
        .set('Idempotency-Key', key)
        .send(body(method, index + 1))
        .expect(200);
    expect(await rows()).toEqual([]);
    expect(
      (await replays())
        .map((row: { operation: string }) => row.operation)
        .sort(),
    ).toEqual([
      'items.create',
      'items.delete',
      'items.replace',
      'items.update',
    ]);
  });

  it('replays an existing creation record using the prior callerScope/hash contract after the option rename', async () => {
    const app = createApp(policy);
    const repository = new IdempotencyRepository();
    const scope = {
      namespace: idempotencyNamespace,
      callerScope: 'public',
      operation: 'items.create',
      route: 'POST /api/v1/items',
    };
    const input = {
      params: null,
      query: null,
      body: { name: 'Old request', price: 1 },
    };
    const scopeHash = idempotencyScopeHash(scope, key);
    const oldItem = await itemRepository.create({
      name: 'Old request',
      price: 1,
    });
    const json = JSON.stringify(toItemDTO(oldItem));
    await AppDataSource.query('DELETE FROM items WHERE id = ?', [oldItem.id]);
    await AppDataSource.manager.transaction(async (manager) => {
      await repository.insertClaim(manager, {
        scope,
        scopeHash,
        fingerprint: requestFingerprint(input),
      });
      await repository.complete(manager, scopeHash, { status: 201, json });
    });
    const create = vi.spyOn(itemRepository, 'create');
    const response = await request(app)
      .post(path)
      .set('Idempotency-Key', key)
      .send(input.body)
      .expect(201);
    expect(response.text).toBe(json);
    expect(create).not.toHaveBeenCalled();
    expect(await rows()).toEqual([]);
  });
});
