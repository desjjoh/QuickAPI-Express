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
import { AppDataSource } from '@/config/database.config';
import { itemRepository } from '@/database/repositories/item.repo';
import {
  connectTestDatabase,
  disconnectTestDatabase,
  resetTestDatabase,
} from '../helpers/database/database';
import { deferred } from '../helpers/http';

const app = createApp();
beforeAll(connectTestDatabase);
beforeEach(resetTestDatabase);
afterEach(() => vi.restoreAllMocks());
afterAll(disconnectTestDatabase);

async function seed() {
  const response = await request(app)
    .post('/api/v1/items')
    .send({ name: 'Original', price: 5, description: 'Keep' });
  expect(response.status).toBe(201);
  expect(response.body.version).toBe(1);
  return response.body as {
    id: string;
    version: number;
    name: string;
    price: number;
    description: string;
  };
}
function mutate(
  method: 'patch' | 'put' | 'delete',
  id: string,
  version: unknown,
  name = 'Changed',
) {
  if (method === 'delete')
    return request(app)
      .post(`/api/v1/items/${id}/delete`)
      .send({ expected_version: version });
  return request(app)
    [method](`/api/v1/items/${id}`)
    .send({ name, price: 6, expected_version: version });
}

// A barrier ensures both HTTP transactions reach the lookup before either proceeds.
function concurrentLookups() {
  const ready = deferred();
  let arrived = 0;
  const lookup = itemRepository.get_by_id_for_update.bind(itemRepository);
  vi.spyOn(itemRepository, 'get_by_id_for_update').mockImplementation(
    async (...args) => {
      if (++arrived === 2) ready.resolve();
      await ready.promise;
      return lookup(...args);
    },
  );
}

describe('item revision HTTP and MySQL contracts', () => {
  it('returns revisions on create/read/list and advances once for accepted no-op edits', async () => {
    const item = await seed();
    expect(
      (await request(app).get(`/api/v1/items/${item.id}`)).body.version,
    ).toBe(1);
    expect((await request(app).get('/api/v1/items')).body.data[0].version).toBe(
      1,
    );
    const patched = await request(app)
      .patch(`/api/v1/items/${item.id}`)
      .send({ name: item.name, expected_version: 1 });
    expect(patched.status).toBe(200);
    expect(patched.body.version).toBe(2);
    const replaced = await request(app).put(`/api/v1/items/${item.id}`).send({
      name: item.name,
      price: item.price,
      description: item.description,
      expected_version: 2,
    });
    expect(replaced.status).toBe(200);
    expect(replaced.body.version).toBe(3);
    const removed = await mutate('delete', item.id, 3);
    expect(removed.status).toBe(200);
    expect(removed.body.version).toBe(3);
    expect(await itemRepository.get_by_id(item.id)).toBeNull();
  });

  it.each(['patch', 'put', 'delete'] as const)(
    'rejects stale %s without mutation and reports missing targets as 404',
    async (method) => {
      const item = await seed();
      expect((await mutate('patch', item.id, 1)).status).toBe(200);
      const before = await itemRepository.get_by_id(item.id);
      expect((await mutate(method, item.id, 1)).status).toBe(409);
      expect(await itemRepository.get_by_id(item.id)).toEqual(before);
      expect((await mutate(method, 'abcdefghijklmnop', 1)).status).toBe(404);
    },
  );

  it.each([undefined, null, 0, -1, 1.5, '1', true, 4294967296])(
    'rejects invalid expected_version %s before any lookup',
    async (version) => {
      const item = await seed();
      const lookup = vi.spyOn(itemRepository, 'get_by_id_for_update');
      for (const method of ['patch', 'put', 'delete'] as const)
        expect((await mutate(method, item.id, version)).status).toBe(422);
      expect(lookup).not.toHaveBeenCalled();
      expect((await itemRepository.get_by_id(item.id))?.version).toBe(1);
    },
  );

  it('rejects version-only PATCH and retires the unversioned DELETE route', async () => {
    const item = await seed();
    expect(
      (
        await request(app)
          .patch(`/api/v1/items/${item.id}`)
          .send({ expected_version: 1 })
      ).status,
    ).toBe(422);
    expect((await request(app).delete(`/api/v1/items/${item.id}`)).status).toBe(
      404,
    );
    expect((await itemRepository.get_by_id(item.id))?.version).toBe(1);
  });

  it('admits one concurrent edit for the same expected version', async () => {
    const item = await seed();
    concurrentLookups();
    const results = await Promise.all([
      mutate('patch', item.id, 1, 'First'),
      mutate('put', item.id, 1, 'Second'),
    ]);
    expect(results.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    const winner = results.find((response) => response.status === 200)!;
    const persisted = await itemRepository.get_by_id(item.id);
    expect(persisted).toMatchObject({ name: winner.body.name, version: 2 });
  });

  it('serializes update/delete races without allowing a stale delete or lost update', async () => {
    const item = await seed();
    concurrentLookups();
    const [updated, removed] = await Promise.all([
      mutate('patch', item.id, 1),
      mutate('delete', item.id, 1),
    ]);
    if (updated.status === 200) {
      expect(updated.body.version).toBe(2);
      expect(removed.status).toBe(409);
      expect((await itemRepository.get_by_id(item.id))?.version).toBe(2);
    } else {
      expect(removed.status).toBe(200);
      expect(updated.status).toBe(404);
      expect(await itemRepository.get_by_id(item.id)).toBeNull();
    }
  });

  it('allows one concurrent delete and returns 404 for the already-deleted target', async () => {
    const item = await seed();
    concurrentLookups();
    const results = await Promise.all([
      mutate('delete', item.id, 1),
      mutate('delete', item.id, 1),
    ]);
    expect(results.map((response) => response.status).sort()).toEqual([
      200, 404,
    ]);
    expect(await itemRepository.get_by_id(item.id)).toBeNull();
  });

  it('guards direct repository writers with the SQL version condition', async () => {
    const item = await itemRepository.create({ name: 'Original', price: 5 });
    await itemRepository.transaction((manager) =>
      itemRepository.update(item, { price: 6 }, 1, manager),
    );
    await expect(
      itemRepository.transaction((manager) =>
        itemRepository.update(item, { price: 7 }, 1, manager),
      ),
    ).rejects.toHaveProperty('status', 409);
    await expect(
      itemRepository.transaction((manager) =>
        itemRepository.remove(item, 1, manager),
      ),
    ).rejects.toHaveProperty('status', 409);
    expect(await itemRepository.get_by_id(item.id)).toMatchObject({
      price: '6.00',
      version: 2,
    });
  });

  it('rejects revision overflow without changing data and still permits versioned deletion', async () => {
    const item = await seed();
    await AppDataSource.query(
      'UPDATE items SET version = 4294967295 WHERE id = ?',
      [item.id],
    );
    expect((await mutate('patch', item.id, 4294967295)).status).toBe(409);
    expect(await itemRepository.get_by_id(item.id)).toMatchObject({
      name: item.name,
      version: 4294967295,
    });
    expect((await mutate('delete', item.id, 4294967295)).status).toBe(200);
  });
});
