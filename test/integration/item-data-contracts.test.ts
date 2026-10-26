import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '@/config/http-server.config';
import { AppDataSource } from '@/config/database.config';
import {
  connectTestDatabase,
  disconnectTestDatabase,
  resetTestDatabase,
} from '../helpers/database/database';

const app = createApp();
beforeAll(connectTestDatabase);
beforeEach(resetTestDatabase);
afterAll(disconnectTestDatabase);

async function rows() {
  return AppDataSource.query('SELECT * FROM items ORDER BY id');
}

describe('item price persistence and query contracts', () => {
  it.each([0.01, 0.07, 0.29, 1.13, 1.15, 2.03, 12.5, 99_999_999.99])(
    'round-trips price %s without changing the submitted value',
    async (price) => {
      const created = await request(app)
        .post('/api/v1/items')
        .send({ name: 'Price fixture', price });
      expect(created.status).toBe(201);
      expect(created.body.price).toBe(price);
      const [stored] = await rows();
      expect(stored.price).toBe(price.toFixed(2));
      const read = await request(app).get(`/api/v1/items/${created.body.id}`);
      expect(read.body.price).toBe(price);
      const patched = await request(app)
        .patch(`/api/v1/items/${created.body.id}`)
        .send({ price: price.toFixed(2), expected_version: 1 });
      expect(patched.status).toBe(200);
      expect(patched.body).toMatchObject({ price, version: 2 });
    },
  );

  it.each([1.001, 0.001, '1.230', '1e2', true, [1], {}, '', null])(
    'rejects invalid price %# before writes or revision changes',
    async (price) => {
      const seed = await request(app)
        .post('/api/v1/items')
        .send({ name: 'Preserve', price: '12.50' });
      expect(seed.status).toBe(201);
      const before = await rows();
      expect(
        (
          await request(app)
            .post('/api/v1/items')
            .send({ name: 'Invalid', price })
        ).status,
      ).toBe(422);
      expect(
        (
          await request(app)
            .patch(`/api/v1/items/${seed.body.id}`)
            .send({ price, expected_version: 1 })
        ).status,
      ).toBe(422);
      expect(
        (
          await request(app)
            .put(`/api/v1/items/${seed.body.id}`)
            .send({ name: 'Invalid', price, expected_version: 1 })
        ).status,
      ).toBe(422);
      expect(await rows()).toEqual(before);
    },
  );

  it('uses inclusive decimal filters and rejects malformed, duplicated and crossed bounds', async () => {
    for (const price of ['1.12', '1.13', '1.50', '2.03', '2.04'])
      expect(
        (
          await request(app)
            .post('/api/v1/items')
            .send({ name: 'Filter', price })
        ).status,
      ).toBe(201);
    const response = await request(app).get(
      '/api/v1/items?min_price=1.13&max_price=2.03',
    );
    expect(response.status).toBe(200);
    expect(
      response.body.data.map((item: { price: number }) => item.price),
    ).toEqual([1.13, 1.5, 2.03]);
    for (const query of [
      'min_price=',
      'max_price=1.234',
      'min_price=2.04&max_price=2.03',
      'min_price=1&min_price=2',
      'min_price=1e2',
    ])
      expect((await request(app).get(`/api/v1/items?${query}`)).status).toBe(
        422,
      );
  });

  it.each(['name', 'price', 'createdAt'] as const)(
    'uses ID to order equal %s values across adjacent pages in both directions',
    async (sort) => {
      const ids = [
        'tiecontract00004',
        'tiecontract00001',
        'tiecontract00005',
        'tiecontract00002',
        'tiecontract00003',
      ];
      for (const id of ids)
        await AppDataSource.query(
          "INSERT INTO items (id, name, price, createdAt, updatedAt) VALUES (?, 'Same', 12.50, '2026-01-01', '2026-01-01')",
          [id],
        );
      for (const order of ['ASC', 'DESC']) {
        const collected: string[] = [];
        for (let page = 1; page <= 3; page++) {
          const response = await request(app).get(
            `/api/v1/items?sort=${sort}&order=${order}&page=${page}&limit=2`,
          );
          expect(response.status).toBe(200);
          expect(response.body.total).toBe(5);
          collected.push(
            ...response.body.data.map((item: { id: string }) => item.id),
          );
        }
        const expected = [...ids].sort();
        if (order === 'DESC') expected.reverse();
        expect(collected).toEqual(expected);
        expect(new Set(collected).size).toBe(5);
      }
    },
  );

  it('returns 422 for unsafe pages or offsets and retains normal empty-page behavior', async () => {
    for (const query of [
      `page=${Number.MAX_SAFE_INTEGER + 1}`,
      `page=${Number.MAX_SAFE_INTEGER}&limit=100`,
    ])
      expect((await request(app).get(`/api/v1/items?${query}`)).status).toBe(
        422,
      );
    const empty = await request(app).get('/api/v1/items?page=2&limit=100');
    expect(empty.status).toBe(200);
    expect(empty.body).toMatchObject({
      page: 2,
      limit: 100,
      total: 0,
      data: [],
    });
  });
});
